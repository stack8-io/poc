import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"

export type KubernetesExternalSecretsArgs = object

export class KubernetesExternalSecrets extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public namespace: k8s.core.v1.Namespace
  public release: k8s.helm.v3.Release
  public httpRoute!: k8s.apiextensions.CustomResource

  constructor(
    name: string,
    args: KubernetesExternalSecretsArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:ExternalSecrets", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.namespace = new k8s.core.v1.Namespace(
      "namespace",
      {
        metadata: {
          name: "external-secrets",
        },
      },
      this.opts,
    )

    this.release = new k8s.helm.v3.Release(
      "release",
      {
        chart: "external-secrets",
        namespace: this.namespace.metadata.name,
        version: "0.9.13",
        repositoryOpts: {
          repo: "https://charts.external-secrets.io",
        },
        values: {},
      },
      {
        ...this.opts,
        // FIXME:
        // It always comes up as a diff, so we'll make it an ignore target once.
        // We want to investigate.
        ignoreChanges: ["checksum"],
      },
    )
  }
}
