import * as aws from "@pulumi/aws"
import * as command from "@pulumi/command"
import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"
import { Stack8AWS } from "../../aws/stack"
import { getResourceTags } from "../../util"

export type KubernetesAWSLoadBalancerControllerArgs = {
  aws: Stack8AWS
  k8sProvider: k8s.Provider
}

export class KubernetesAWSLoadBalancerController extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public k8sOpts: pulumi.ResourceOptions
  public release: k8s.helm.v3.Release
  public targetGroupBinding: k8s.apiextensions.CustomResource

  constructor(
    name: string,
    args: KubernetesAWSLoadBalancerControllerArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super(
      "stack8:kubernetes:aws:AWSloadBalancerController",
      name,
      undefined,
      opts,
    )

    this.opts = { ...opts, parent: this }
    this.k8sOpts = { ...this.opts, provider: args.k8sProvider }

    const namespace = "kube-system"
    const serviceAccountName = "aws-load-balancer-controller"
    const policyJson = new command.local.Command(
      "policy",
      {
        create:
          "curl https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.6.1/docs/install/iam_policy.json",
      },
      opts,
    )
    const saAssumeRolePolicy = pulumi
      .all([
        args.aws.cluster.oidcProvider.url,
        args.aws.cluster.oidcProvider.arn,
      ])
      .apply(([url, arn]) =>
        aws.iam.getPolicyDocument({
          statements: [
            {
              actions: ["sts:AssumeRoleWithWebIdentity"],
              conditions: [
                {
                  test: "StringEquals",
                  values: [
                    `system:serviceaccount:${namespace}:${serviceAccountName}`,
                  ],
                  variable: `${url.replace("https://", "")}:sub`,
                },
              ],
              effect: "Allow",
              principals: [
                {
                  identifiers: [arn],
                  type: "Federated",
                },
              ],
            },
          ],
        }),
      )

    const roleTags = getResourceTags(serviceAccountName)
    const role = new aws.iam.Role(
      "role",
      {
        name: roleTags.Name,
        assumeRolePolicy: saAssumeRolePolicy.json,
        tags: roleTags,
        inlinePolicies: [
          {
            name: roleTags.Name,
            policy: policyJson.stdout,
          },
        ],
      },
      opts,
    )

    const sa = new k8s.core.v1.ServiceAccount(
      "sa-aws-lb",
      {
        metadata: {
          namespace,
          name: serviceAccountName,
          annotations: {
            "eks.amazonaws.com/role-arn": role.arn,
          },
        },
      },
      this.k8sOpts,
    )

    this.release = new k8s.helm.v3.Release(
      "release",
      {
        chart: "aws-load-balancer-controller",
        namespace,
        version: "1.6.2",
        repositoryOpts: {
          repo: "https://aws.github.io/eks-charts",
        },
        values: {
          clusterName: args.aws.cluster.cluster.name,
          region: aws.config.region,
          vpcId: args.aws.network.vpc.id,
          serviceAccount: {
            create: false,
            name: sa.metadata.name,
          },
          enableBackendSecurityGroup: false,
          // NOTE:
          // With Cilium, the type of Service resource created for the GatewayAPI cannot
          // be set to anything other than LoadBalancer.
          // https://github.com/cilium/cilium/issues/27273
          //
          // To manage LB on the Pulumi side, disable the creation of LB by ALB Controller
          // using the EnableServiceController flag.
          controllerConfig: {
            featureGates: {
              EnableServiceController: false,
            },
          },
        },
      },
      {
        ...this.k8sOpts,
        // FIXME: 常に差分として出てくるので一旦コメントアウト。調べてほしい。
        ignoreChanges: ["checksum"],
      },
    )

    this.targetGroupBinding = new k8s.apiextensions.CustomResource(
      "target-group-binding",
      {
        apiVersion: "elbv2.k8s.aws/v1beta1",
        kind: "TargetGroupBinding",
        metadata: {
          namespace: "kube-system",
          name: "cilium-gateway",
        },
        spec: {
          // NOTE:
          // This service is created by Cilium according to the Gateway configuration.
          // The name prefix `cilium-gateway` is automatically assigned by Cilium.
          serviceRef: {
            name: "cilium-gateway-gateway",
            port: 80,
          },
          targetGroupARN: args.aws.network.loadBalancerTargetGroup.arn,
          targetType: "instance",
        },
      },
      {
        ...this.k8sOpts,
        dependsOn: [this.release],
        deleteBeforeReplace: true,
        replaceOnChanges: ["spec.targetGroupARN", "spec.targetType"],
      },
    )
  }
}
