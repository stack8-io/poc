import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"

export type KuberneteGatewayAPIArgs = object

export class KuberneteGatewayApi extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public configFile: k8s.yaml.ConfigFile

  constructor(
    name: string,
    args: KuberneteGatewayAPIArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:GatewayAPI", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.configFile = new k8s.yaml.ConfigFile(
      "config-file",
      {
        file: "https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.0.0/experimental-install.yaml",
      },
      this.opts,
    )
  }
}
