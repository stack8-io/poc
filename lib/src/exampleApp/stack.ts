import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"

export type Stack8ExampleAppArgs = {
  database: {
    user: string
    password: string
    endpoint: pulumi.Output<string>
    name: pulumi.Output<string>
  }
}

export class Stack8ExampleApp extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public namespace: k8s.core.v1.Namespace
  public dragonfly: k8s.apiextensions.CustomResource
  public postgresDatabse: k8s.apiextensions.CustomResource
  public postgresUser: k8s.apiextensions.CustomResource
  // public deployment: k8s.apps.v1.Deployment
  // public service: k8s.core.v1.Service

  constructor(
    name: string,
    args: Stack8ExampleAppArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:exampleApp", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.namespace = new k8s.core.v1.Namespace(
      "namespace",
      {
        metadata: {
          name: "example-app",
        },
      },
      this.opts,
    )

    const dragonflyPassword = new k8s.apiextensions.CustomResource(
      "dragonfly-password",
      {
        apiVersion: "generators.external-secrets.io/v1alpha1",
        kind: "Password",
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "dragonfly",
        },
        spec: {},
      },
      this.opts,
    )

    const dragonflySecret = new k8s.apiextensions.CustomResource(
      "dragonfly-secret",
      {
        apiVersion: "external-secrets.io/v1beta1",
        kind: "ExternalSecret",
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "dragonfly",
        },
        spec: {
          target: {
            name: "dragonfly-secret",
          },
          dataFrom: [
            {
              sourceRef: {
                generatorRef: {
                  apiVersion: dragonflyPassword.apiVersion,
                  kind: dragonflyPassword.kind,
                  name: dragonflyPassword.metadata.name,
                },
              },
            },
          ],
        },
      },
      this.opts,
    )

    this.dragonfly = new k8s.apiextensions.CustomResource(
      "dragonfly",
      {
        apiVersion: "dragonflydb.io/v1alpha1",
        kind: "Dragonfly",
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "dragonfly",
        },
        spec: {
          authentication: {
            passwordFromSecret: {
              name: "dragonfly-secret",
              key: "password",
            },
          },
          replicas: 1,
          args: ["--maxmemory", "256mb", "--proactor_threads", "1"],
          resources: {
            limits: {
              cpu: "100m",
            },
          },
        },
      },
      this.opts,
    )

    this.postgresDatabse = new k8s.apiextensions.CustomResource(
      "postgres-database",
      {
        apiVersion: "db.movetokube.com/v1alpha1",
        kind: "Postgres",
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "example-app",
        },
        spec: {
          database: "example-app",
          dropOnDelete: true,
          schemas: ["public", "dev", "test"],
          extensions: ["pgcrypto", "pg_bigm"],
        },
      },
      this.opts,
    )

    this.postgresUser = new k8s.apiextensions.CustomResource(
      "postgres-user",
      {
        apiVersion: "db.movetokube.com/v1alpha1",
        kind: "PostgresUser",
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "example-app",
        },
        spec: {
          role: "example-app",
          database: "example-app",
          secretName: "secret",
          privileges: "OWNER",
        },
      },
      this.opts,
    )

    // this.deployment = new k8s.apps.v1.Deployment(
    //   "deployment",
    //   {
    //     metadata: {
    //       namespace: this.namespace.metadata.name,
    //       name: "hasura",
    //       labels: {
    //         app: "hasura",
    //       },
    //     },
    //     spec: {
    //       replicas: 1,
    //       selector: {
    //         matchLabels: {
    //           app: "hasura",
    //         },
    //       },
    //       template: {
    //         metadata: {
    //           labels: {
    //             app: "hasura",
    //           },
    //         },
    //         spec: {
    //           containers: [
    //             {
    //               image: "hasura/graphql-engine:v2.36.0",
    //               name: "hasura",
    //               env: [
    //                 {
    //                   name: "HASURA_GRAPHQL_DATABASE_URL",
    //                   value: pulumi.interpolate`postgres://${args.database.user}:${args.database.password}@${args.database.endpoint}/${args.database.name}`,
    //                 },
    //                 {
    //                   name: "HASURA_GRAPHQL_ENABLE_CONSOLE",
    //                   value: "true",
    //                 },
    //                 {
    //                   name: "HASURA_GRAPHQL_DEV_MODE",
    //                   value: "true",
    //                 },
    //               ],
    //               ports: [
    //                 {
    //                   name: "http",
    //                   containerPort: 8080,
    //                 },
    //               ],
    //               livenessProbe: {
    //                 httpGet: {
    //                   path: "/healthz",
    //                   port: "http",
    //                 },
    //               },
    //               readinessProbe: {
    //                 httpGet: {
    //                   path: "/healthz",
    //                   port: "http",
    //                 },
    //               },
    //             },
    //           ],
    //         },
    //       },
    //     },
    //   },
    //   this.opts,
    // )

    // this.service = new k8s.core.v1.Service(
    //   "service",
    //   {
    //     metadata: {
    //       namespace: this.namespace.metadata.name,
    //       name: "hasura",
    //       labels: {
    //         app: "hasura",
    //       },
    //     },
    //     spec: {
    //       ports: [
    //         {
    //           port: 80,
    //           protocol: "TCP",
    //           targetPort: 8080,
    //         },
    //       ],
    //       selector: {
    //         app: "hasura",
    //       },
    //       type: "ClusterIP",
    //     },
    //   },
    //   this.opts,
    // )
  }
}
