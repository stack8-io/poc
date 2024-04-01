import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"

export type KubernetesPostgresOperatorArgs = {
  host: pulumi.Input<string>
  user: pulumi.Input<string>
  password: pulumi.Input<string>
  defaultDatabase: pulumi.Input<string>
}

export class KubernetesPostgresOperator extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public namespace: k8s.core.v1.Namespace
  public release: k8s.helm.v3.Release

  constructor(
    name: string,
    args: KubernetesPostgresOperatorArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:PostgresOperator", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.namespace = new k8s.core.v1.Namespace(
      "namespace",
      {
        metadata: {
          name: "postgres-operator",
        },
      },
      this.opts,
    )

    this.release = new k8s.helm.v3.Release(
      "release",
      {
        chart: "ext-postgres-operator",
        namespace: this.namespace.metadata.name,
        version: "1.2.6",
        repositoryOpts: {
          repo: "https://movetokube.github.io/postgres-operator/",
        },
        values: {
          postgres: {
            host: args.host,
            user: args.user,
            password: args.password,
            cloud_provider: "AWS",
            default_database: args.defaultDatabase,
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
  }
}
