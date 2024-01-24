import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"

export type KubernetesAWSCoreDnsArgs = {
  clusterName: pulumi.Input<string>
}

export class KubernetesAWSCoreDns extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public addon: aws.eks.Addon

  constructor(
    name: string,
    args: KubernetesAWSCoreDnsArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:aws:CoreDns", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.addon = new aws.eks.Addon(
      "addon",
      {
        clusterName: args?.clusterName,
        addonName: "coredns",
        addonVersion: "v1.10.1-eksbuild.6",
        resolveConflictsOnCreate: "OVERWRITE",
        resolveConflictsOnUpdate: "OVERWRITE",
      },
      this.opts,
    )
  }
}
