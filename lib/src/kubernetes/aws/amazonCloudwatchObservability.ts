import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"

export type KubernetesAWSAmazonCloudwatchObservabilityArgs = {
  clusterName: pulumi.Input<string>
}

export class KubernetesAWSAmazonCloudwatchObservability extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public addon: aws.eks.Addon

  constructor(
    name: string,
    args: KubernetesAWSAmazonCloudwatchObservabilityArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super(
      "stack8:kubernetes:aws:AmazonCloudwatchObservability",
      name,
      undefined,
      opts,
    )

    this.opts = { ...opts, parent: this }

    this.addon = new aws.eks.Addon(
      "addon",
      {
        clusterName: args?.clusterName,
        addonName: "amazon-cloudwatch-observability",
        addonVersion: "v1.2.1-eksbuild.1",
        resolveConflictsOnCreate: "OVERWRITE",
        resolveConflictsOnUpdate: "OVERWRITE",
      },
      this.opts,
    )
  }
}
