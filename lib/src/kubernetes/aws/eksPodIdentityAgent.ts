import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"

export type KubernetesAWSEKSPodIdentityAgentArgs = {
  clusterName: pulumi.Input<string>
}

export class KubernetesAWSEKSPodIdentityAgent extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public addon: aws.eks.Addon

  constructor(
    name: string,
    args: KubernetesAWSEKSPodIdentityAgentArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super(
      "stack8:kubernetes:aws:EKSPodIdentityAgentArgs",
      name,
      undefined,
      opts,
    )

    this.opts = { ...opts, parent: this }

    this.addon = new aws.eks.Addon(
      "addon",
      {
        clusterName: args.clusterName,
        addonName: "eks-pod-identity-agent",
        addonVersion: "v1.0.0-eksbuild.1",
        resolveConflictsOnCreate: "OVERWRITE",
        resolveConflictsOnUpdate: "OVERWRITE",
      },
      this.opts,
    )
  }
}
