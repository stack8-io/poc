import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { getAssumeRoleForEKSPodIdentity } from "../../util"

export type KubernetesAWSAmazonEBSCSIDriverArgs = {
  clusterName: pulumi.Input<string>
}

export class KubernetesAWSAmazonEBSCSIDriver extends pulumi.ComponentResource {
  public static readonly namespace = "kube-system"
  public static readonly saName = "ebs-csi-controller-sa"

  public opts: pulumi.ResourceOptions
  public addon: aws.eks.Addon
  public role: aws.iam.Role

  constructor(
    name: string,
    args: KubernetesAWSAmazonEBSCSIDriverArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:aws:AmazonEBSCSIDriver", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    // FIXME: Use Kustomize or Helm to install with the benefit of being able to specify the name of the ServiceAccount and Namespace.
    this.addon = new aws.eks.Addon(
      "addon",
      {
        clusterName: args.clusterName,
        addonName: "aws-ebs-csi-driver",
        addonVersion: "v1.28.0-eksbuild.1",
        resolveConflictsOnCreate: "OVERWRITE",
        resolveConflictsOnUpdate: "OVERWRITE",
      },
      this.opts,
    )

    this.role = new aws.iam.Role(
      "role",
      {
        name: KubernetesAWSAmazonEBSCSIDriver.saName,
        managedPolicyArns: [
          "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy",
        ],
        assumeRolePolicy: getAssumeRoleForEKSPodIdentity(),
      },
      this.opts,
    )

    new aws.eks.PodIdentityAssociation(
      "pod-identity-association",
      {
        clusterName: args.clusterName,
        namespace: KubernetesAWSAmazonEBSCSIDriver.namespace,
        serviceAccount: KubernetesAWSAmazonEBSCSIDriver.saName,
        roleArn: this.role.arn,
      },
      this.opts,
    )
  }
}
