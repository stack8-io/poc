import * as aws from "@pulumi/aws"
import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"
import * as R from "remeda"
import { getAssumeRoleForEKSPodIdentity, getResourceTags } from "../util"

export type KuberneteExternalDNSArgs = {
  clusterName: pulumi.Input<string>
  oidcProvider: aws.iam.OpenIdConnectProvider
  domainHostZoneMap: Map<string, aws.route53.Zone>
  groupNameDistributionMap: Map<string, aws.cloudfront.Distribution>
  k8sProvider: k8s.Provider
}

export class KuberneteExternalDNS extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public k8sOpts: pulumi.ResourceOptions

  constructor(
    name: string,
    args: KuberneteExternalDNSArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:ExternalDNS", name, undefined, opts)

    this.opts = { ...opts, parent: this }
    this.k8sOpts = { ...this.opts, provider: args.k8sProvider }

    const namespace = "external-dns"
    const resourceName = "external-dns"
    const tags = getResourceTags(resourceName)

    const hostZoneArns = Array.from(args.domainHostZoneMap.values()).map(
      x => x.arn,
    )
    const policy = pulumi.all(hostZoneArns).apply(arns =>
      aws.iam.getPolicyDocument({
        statements: [
          {
            effect: "Allow",
            actions: ["route53:ChangeResourceRecordSets"],
            resources: arns,
          },
          {
            effect: "Allow",
            actions: [
              "route53:ListHostedZones",
              "route53:ListResourceRecordSets",
              "route53:ListTagsForResource",
            ],
            resources: ["*"],
          },
        ],
      }),
    )

    const role = new aws.iam.Role(
      "role",
      {
        name: tags.Name,
        inlinePolicies: [
          {
            name: tags.Name,
            policy: policy.json,
          },
        ],
        assumeRolePolicy: getAssumeRoleForEKSPodIdentity(),
        tags,
      },
      this.opts,
    )

    const ns = new k8s.core.v1.Namespace(
      "namespace",
      {
        metadata: {
          name: namespace,
        },
      },
      this.k8sOpts,
    )

    const sa = new k8s.core.v1.ServiceAccount(
      "sa",
      {
        metadata: {
          namespace,
          name: resourceName,
          annotations: {
            "eks.amazonaws.com/role-arn": role.arn,
          },
        },
      },
      this.k8sOpts,
    )

    const podIdentityAssociation = new aws.eks.PodIdentityAssociation(
      "pod-identity-association",
      {
        clusterName: args.clusterName,
        namespace,
        serviceAccount: sa.metadata.name,
        roleArn: role.arn,
      },
      this.opts,
    )

    const clusterRole = new k8s.rbac.v1.ClusterRole(
      "cluster-role",
      {
        metadata: {
          name: resourceName,
        },
        rules: [
          {
            apiGroups: [""],
            resources: ["namespaces"],
            verbs: ["get", "watch", "list"],
          },
          {
            apiGroups: ["gateway.networking.k8s.io"],
            resources: [
              "gateways",
              "httproutes",
              "grpcroutes",
              "tlsroutes",
              "tcproutes",
              "udproutes",
            ],
            verbs: ["get", "watch", "list"],
          },
        ],
      },
      this.k8sOpts,
    )

    const clusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding(
      "cluster-role-binding",
      {
        metadata: {
          name: resourceName,
        },
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: clusterRole.kind,
          name: clusterRole.metadata.name,
        },
        subjects: [
          {
            kind: sa.kind,
            namespace: sa.metadata.namespace,
            name: sa.metadata.name,
          },
        ],
      },
      this.k8sOpts,
    )

    Array.from(args.groupNameDistributionMap.entries()).map(
      ([groupName, distribution]) => {
        distribution.domainName.apply(domainName => {
          const name = `${resourceName}-${groupName}`
          new k8s.apps.v1.Deployment(
            `deployment-${groupName}`,
            {
              metadata: {
                namespace,
                name,
              },
              spec: {
                selector: {
                  matchLabels: {
                    app: name,
                  },
                },
                template: {
                  metadata: {
                    labels: {
                      app: name,
                    },
                  },
                  spec: {
                    serviceAccount: sa.metadata.name,
                    containers: [
                      {
                        name: resourceName,
                        image:
                          "gcr.io/k8s-staging-external-dns/external-dns@sha256:62e232351ae5f2a3af0b7a3ae79fb7ea763291ec4c039b89d7103f05cfdf01e6",
                        args: R.compact([
                          "--log-level=debug",
                          "--source=gateway-httproute",
                          "--source=gateway-grpcroute",
                          "--source=gateway-tlsroute",
                          "--source=gateway-tcproute",
                          "--source=gateway-udproute",
                          "--provider=aws",
                          "--aws-zone-type=public",
                          // NOTE:
                          // Whenever the zone changes, the definition of this
                          // deployment also changes, so there is no problem with Cache.
                          "--aws-zones-cache-duration=1h",
                          "--policy=upsert-only",
                          "--registry=txt",
                          `--txt-owner-id=${tags.Name}`,
                          `--default-targets=${domainName}`,
                          ...Array.from(args.domainHostZoneMap.keys()).map(
                            x => `--domain-filter=${x}`,
                          ),
                          args.groupNameDistributionMap.size > 1
                            ? `--gateway-label-filter=stack8.io/cdn-group=${groupName}`
                            : "",
                        ]),
                      },
                    ],
                  },
                },
              },
            },
            this.k8sOpts,
          )
        })
      },
    )
  }
}
