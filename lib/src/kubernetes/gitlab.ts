import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"

export type KubernetesGitlabArgs = {
  domain: string
}

export class KubernetesGitlab extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public namespace: k8s.core.v1.Namespace
  public release: k8s.helm.v3.Release
  public httpRoute!: k8s.apiextensions.CustomResource

  constructor(
    name: string,
    args: KubernetesGitlabArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:Gitlab", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.namespace = new k8s.core.v1.Namespace(
      "namespace",
      {
        metadata: {
          name: "gitlab",
        },
      },
      this.opts,
    )

    this.release = new k8s.helm.v3.Release(
      "release",
      {
        chart: "gitlab",
        namespace: this.namespace.metadata.name,
        version: "7.9.1",
        repositoryOpts: {
          repo: "https://charts.gitlab.io/",
        },
        values: {
          global: {
            hosts: {
              domain: args.domain,
              https: false,
            },
            ingress: {
              enabled: false,
            },
            kas: {
              enabled: false,
            },
            registry: {
              enabled: false,
            },
          },
          gitlab: {
            "gitlab-shell": {
              enabled: false,
            },
          },
          certmanager: {
            install: false,
          },
          // NOTE: Set dummy values to pass Helm Chart argument checks
          "certmanager-issuer": {
            email: "no-reply@example.com",
          },
          "nginx-ingress": {
            enabled: false,
          },
          prometheus: {
            install: false,
          },
          registry: {
            enabled: false,
          },
        },
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
            name: "gitlab",
          },
          spec: {
            parentRefs: [
              {
                name: "gateway",
                namespace: "kube-system",
              },
            ],
            hostnames: [`gitlab.${args.domain}`],
            rules: [
              {
                backendRefs: [
                  {
                    name: `${x}-webservice-default`,
                    port: 8181,
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
