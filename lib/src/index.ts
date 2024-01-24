import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"

import { Stack8AWS } from "./aws/stack"
import { Stack8ExampleApp } from "./exampleApp/stack"
import { Stack8Kubernetes } from "./kubernetes/stack"
import { Stack8Args, Stack8ArgsSchema } from "./schema"

export class Stack8 extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public k8sOpts: pulumi.ResourceOptions
  public aws: Stack8AWS
  public k8sProvider: k8s.Provider
  public kubernetes: Stack8Kubernetes
  public exampleApp: Stack8ExampleApp

  constructor(name: string, args: Stack8Args, opts?: pulumi.ResourceOptions) {
    super("stack8", name, undefined, opts)

    Stack8ArgsSchema.parse(args)

    this.opts = { ...opts, parent: this }

    this.aws = new Stack8AWS("aws", args.aws, this.opts)

    this.k8sProvider = new k8s.Provider(
      "k8s-provider",
      {
        kubeconfig: this.aws.cluster.getKubeconfig(),
        enableServerSideApply: true,
      },
      this.opts,
    )

    this.k8sOpts = {
      ...this.opts,
      provider: this.k8sProvider,
      dependsOn: [this.aws],
    }

    this.kubernetes = new Stack8Kubernetes(
      "kubernetes",
      {
        aws: this.aws,
        k8sProvider: this.k8sProvider,
      },
      { ...this.opts, dependsOn: [this.aws] },
    )

    this.exampleApp = new Stack8ExampleApp(
      "exampleApp",
      {
        database: {
          user: "postgres",
          password: args.aws.databasePassword,
          endpoint: this.aws.database.cluster.endpoint,
          name: this.aws.database.cluster.databaseName,
        },
      },
      this.k8sOpts,
    )
  }
}

export * from "./schema"
