import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"

export type KubernetesOneDevArgs = {
  domain: string
}

export class KubernetesOneDev extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public namespace: k8s.core.v1.Namespace
  public release: k8s.helm.v3.Release
  public httpRoute!: k8s.apiextensions.CustomResource

  constructor(
    name: string,
    args: KubernetesOneDevArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:OneDev", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.namespace = new k8s.core.v1.Namespace(
      "namespace",
      {
        metadata: {
          name: "onedev",
        },
      },
      this.opts,
    )

    this.release = new k8s.helm.v3.Release(
      "release",
      {
        chart: "onedev",
        namespace: this.namespace.metadata.name,
        version: "10.3.0",
        repositoryOpts: {
          repo: "https://dl.cloudsmith.io/public/onedev/onedev/helm/charts/",
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

    this.release.name.apply(x => {
      this.httpRoute = new k8s.apiextensions.CustomResource(
        "http-route",
        {
          apiVersion: "gateway.networking.k8s.io/v1beta1",
          kind: "HTTPRoute",
          metadata: {
            namespace: this.namespace.metadata.name,
            name: "onedev",
          },
          spec: {
            parentRefs: [
              {
                name: "gateway",
                namespace: "kube-system",
              },
            ],
            hostnames: [args.domain],
            rules: [
              {
                backendRefs: [
                  {
                    name: `${x}-onedev`,
                    port: 80,
                  },
                ],
              },
            ],
          },
        },
        this.opts,
      )
    })
  }
}
