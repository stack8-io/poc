import * as aws from "@pulumi/aws"
import * as command from "@pulumi/command"
import * as pulumi from "@pulumi/pulumi"
import { getResourceTags } from "../util"

export type ClusterArgs = {
  vpcId: pulumi.Input<string>
  clusterSubnetIds: pulumi.Input<pulumi.Input<string>[]>
  nodeGroupSubnetIds: pulumi.Input<pulumi.Input<string>[]>
  nodeSecurityGroupId: pulumi.Input<string>
}

export class AWSCluster extends pulumi.ComponentResource {
  public static readonly version = "1.28"

  public opts: pulumi.ResourceOptions
  public cluster: aws.eks.Cluster
  public vpcCniAddon: aws.eks.Addon
  public oidcProvider: aws.iam.OpenIdConnectProvider
  public nodeGroup: aws.eks.NodeGroup

  public getKubeconfig(): pulumi.Output<string> {
    const config = generateKubeconfig(
      this.cluster.name,
      this.cluster.endpoint,
      this.cluster.certificateAuthority?.data,
    )
    return pulumi.output(config).apply(JSON.stringify)
  }

  constructor(name: string, args: ClusterArgs, opts?: pulumi.ResourceOptions) {
    super("stack8:aws:Cluster", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    const clusterRoleTags = getResourceTags("cluster")
    const clusterRole = new aws.iam.Role(
      "role-cluster",
      {
        name: clusterRoleTags.Name,
        assumeRolePolicy: {
          Version: "2012-10-17",
          Statement: [
            {
              Action: "sts:AssumeRole",
              Principal: {
                Service: "eks.amazonaws.com",
              },
              Effect: "Allow",
            },
          ],
        },
        managedPolicyArns: [
          "arn:aws:iam::aws:policy/AmazonEKSServicePolicy",
          "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
        ],
        tags: clusterRoleTags,
      },
      this.opts,
    )

    const sgTags = getResourceTags("cluster")
    const sg = new aws.ec2.SecurityGroup(
      "security-group",
      {
        name: sgTags.Name,
        vpcId: args.vpcId,
        ingress: [
          {
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            self: true,
          },
        ],
        egress: [
          {
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
            ipv6CidrBlocks: ["::/0"],
          },
        ],
        tags: sgTags,
      },
      opts,
    )
    const clusterTags = getResourceTags()
    this.cluster = new aws.eks.Cluster(
      "cluster",
      {
        name: clusterTags.Name,
        roleArn: clusterRole.arn,
        kubernetesNetworkConfig: {
          ipFamily: "ipv4",
        },
        vpcConfig: {
          securityGroupIds: [sg.id],
          subnetIds: args.clusterSubnetIds,
          endpointPrivateAccess: true,
        },
        version: AWSCluster.version,
        tags: clusterTags,
      },
      this.opts,
    )

    // NOTE:
    // Since we use Cilium, there is essentially no need to install the vpc-cni add-on,
    // but we use it because it is the easiest way to set up NodeGroup after setting ENABLE_PREFIX_DELEGATION
    // to increase the number of pods that can be created in one Node.
    this.vpcCniAddon = new aws.eks.Addon(
      "vpc-cni-addon",
      {
        clusterName: this.cluster.name,
        addonName: "vpc-cni",
        addonVersion: "v1.16.0-eksbuild.1",
        resolveConflictsOnCreate: "OVERWRITE",
        resolveConflictsOnUpdate: "OVERWRITE",
        configurationValues: JSON.stringify({
          env: {
            ENABLE_PREFIX_DELEGATION: "true",
            WARM_PREFIX_TARGET: "1",
          },
        }),
      },
      this.opts,
    )

    const thumbprint = new command.local.Command(
      "thumbprint",
      {
        create: `openssl s_client -servername oidc.eks.${aws.config.region}.amazonaws.com -connect oidc.eks.${aws.config.region}.amazonaws.com:443 2>&- | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' | openssl x509 -fingerprint -noout | sed 's/://g' | awk -F= '{print $2}'`,
      },
      this.opts,
    )

    this.oidcProvider = new aws.iam.OpenIdConnectProvider(
      "oidc-provider",
      {
        url: this.cluster.identities[0].oidcs[0].issuer,
        clientIdLists: ["sts.amazonaws.com"],
        thumbprintLists: [thumbprint.stdout.apply(x => x.toLocaleLowerCase())],
        tags: getResourceTags(),
      },
      this.opts,
    )

    const nodeRoleTags = getResourceTags("node")
    const nodeRole = new aws.iam.Role(
      "role-node",
      {
        name: nodeRoleTags.Name,
        assumeRolePolicy: {
          Version: "2012-10-17",
          Statement: [
            {
              Action: "sts:AssumeRole",
              Principal: {
                Service: "ec2.amazonaws.com",
              },
              Effect: "Allow",
            },
          ],
        },
        managedPolicyArns: [
          "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
          "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
          "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
          "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
          "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
          "arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess",
        ],
        tags: nodeRoleTags,
      },
      this.opts,
    )
    const nodeRolePolicyForIpv6Tags = getResourceTags("node-policy-for-ipv6")
    const nodeRolePolicyForIpv6 = new aws.iam.RolePolicy(
      "node-policy-for-ipv6",
      {
        name: nodeRolePolicyForIpv6Tags.Name,
        policy: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["ec2:AssignIpv6Addresses"],
              Resource: "*",
            },
          ],
        },
        role: nodeRole,
      },
      this.opts,
    )

    const temlateTags = getResourceTags("node")
    const lanchTemplate = new aws.ec2.LaunchTemplate(
      "launch-template",
      {
        name: temlateTags.Name,
        // NOTE:
        // By default, `EKS optimized Amazon Linux` is used, but use the more optimized `Bottlerocket`
        // see: https://github.com/bottlerocket-os/bottlerocket
        // imageId: aws.ssm
        //   .getParameter({
        //     name: `/aws/service/bottlerocket/aws-k8s-${AWSCluster.version}/x86_64/latest/image_id`,
        //   })
        //   .then(x =>
        //     aws.ec2
        //       .getAmiIds({
        //         owners: ["amazon"],
        //         filters: [
        //           {
        //             name: "image-id",
        //             values: [x.value],
        //           },
        //         ],
        //       })
        //       .then(y => y.ids[0]),
        //   ),
        // userData: getBottlerocketConfigToml(
        //   this.cluster.name,
        //   this.cluster.endpoint,
        //   this.cluster.certificateAuthorities[0].data,
        // ).apply(x => Buffer.from(x).toString("base64")),
        metadataOptions: {
          httpTokens: "optional",
          // FIXME: Disabled IMDSv1
          // When this is enabled, the following error occurs that
          // EC2 Metadata cannot be retrieved by cloudwatch-agent pods.
          // I don't think it is that important, so I'll put it off.
          // `Fetch hostname from EC2 metadata fail: EC2MetadataError`
          // httpTokens: "required",
        },
        networkInterfaces: [
          {
            securityGroups: [args.nodeSecurityGroupId, sg.id],
          },
        ],
        tagSpecifications: [
          {
            resourceType: "instance",
            tags: temlateTags,
          },
        ],
        tags: temlateTags,
      },
      this.opts,
    )

    const nodegroupTags = getResourceTags()
    this.nodeGroup = new aws.eks.NodeGroup(
      "node-group",
      {
        nodeGroupName: nodegroupTags.Name,
        clusterName: this.cluster.name,
        nodeRoleArn: nodeRole.arn,
        instanceTypes: ["t3.medium"],
        scalingConfig: {
          desiredSize: 2,
          maxSize: 2,
          minSize: 2,
        },
        subnetIds: args.nodeGroupSubnetIds,
        launchTemplate: {
          id: lanchTemplate.id,
          version: lanchTemplate.latestVersion.apply(x => String(x)),
        },
        // NOTE:
        // taint nodes so that application pods are
        // not scheduled/executed until Cilium is deployed.
        // Alternatively, see the note above regarding taint effects.
        // see: https://docs.cilium.io/
        taints: [
          {
            key: "node.cilium.io/agent-not-ready",
            value: "true",
            effect: "NO_EXECUTE",
          },
        ],
        tags: nodegroupTags,
      },
      { ...this.opts, dependsOn: [this.vpcCniAddon] },
    )
  }
}

export function getBottlerocketConfigToml(
  clusterName: pulumi.Input<string>,
  clusterEndpoint: pulumi.Input<string>,
  certData: pulumi.Input<string>,
) {
  return pulumi.interpolate`# https://github.com/bottlerocket-os/bottlerocket/blob/develop/README.md#description-of-settings
[settings.kubernetes]
api-server = "${clusterEndpoint}"
cluster-certificate = "${certData}"
cluster-name = "${clusterName}"

# The admin host container provides SSH access and runs with "superpowers".
# It is disabled by default, but can be disabled explicitly.
[settings.host-containers.admin]
enabled = false

# The control host container provides out-of-band access via SSM.
# It is enabled by default, and can be disabled if you do not expect to use SSM.
# This could leave you with no way to access the API and change settings on an existing node!
[settings.host-containers.control]
enabled = true
`
}

export function generateKubeconfig(
  clusterName: pulumi.Input<string>,
  clusterEndpoint: pulumi.Input<string>,
  certData?: pulumi.Input<string>,
) {
  const args = ["eks", "get-token", "--cluster-name", clusterName]
  const env = [
    {
      name: "KUBERNETES_EXEC_INFO",
      value: `{"apiVersion": "client.authentication.k8s.io/v1beta1"}`,
    },
  ]
  return pulumi.all([args, env]).apply(([tokenArgs, envvars]) => {
    return {
      apiVersion: "v1",
      clusters: [
        {
          cluster: {
            server: clusterEndpoint,
            "certificate-authority-data": certData,
          },
          name: "kubernetes",
        },
      ],
      contexts: [
        {
          context: {
            cluster: "kubernetes",
            user: "aws",
          },
          name: "aws",
        },
      ],
      "current-context": "aws",
      kind: "Config",
      users: [
        {
          name: "aws",
          user: {
            exec: {
              apiVersion: "client.authentication.k8s.io/v1beta1",
              command: "aws",
              args: tokenArgs,
              env: envvars,
            },
          },
        },
      ],
    }
  })
}
