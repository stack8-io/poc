import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"

export type KubernetesDragonflyArgs = object

export class KubernetesDragonfly extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public configFile: k8s.yaml.ConfigFile

  constructor(
    name: string,
    args: KubernetesDragonflyArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:Kubernetess:Dragonfly", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.configFile = new k8s.yaml.ConfigFile(
      "config-file",
      {
        file: "https://raw.githubusercontent.com/dragonflydb/dragonfly-operator/v1.1.1/manifests/dragonfly-operator.yaml",
      },
      this.opts,
    )
  }
}
