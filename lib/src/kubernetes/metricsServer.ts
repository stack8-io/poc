import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"

export type KubernetesMetricsServerArgs = object

export class KubernetesMetricsServer extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public configFile: k8s.yaml.ConfigFile

  constructor(
    name: string,
    args: KubernetesMetricsServerArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:MetricsServer", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.configFile = new k8s.yaml.ConfigFile(
      "config-file",
      {
        file: "https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.0/components.yaml",
      },
      this.opts,
    )
  }
}
