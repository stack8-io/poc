import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"
import { Stack8AWS } from "../aws/stack"
import { AWSArgs } from "../schema"
import { KubernetesAWS } from "./aws/stack"
import { KuberneteCilium } from "./cilium"
import { KuberneteContainerSSH } from "./containerSsh"
import { KuberneteExternalDNS } from "./externalDns"
import { KuberneteGatewayApi } from "./gatewayApi"

export type Stack8KubernetesArgs = AWSArgs & {
  aws: Stack8AWS
  k8sProvider: k8s.Provider
}

export class Stack8Kubernetes extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public k8sOpts: pulumi.ResourceOptions
  public aws: KubernetesAWS
  public gatewayApi: KuberneteGatewayApi
  public externalDns: KuberneteExternalDNS
  public cilium: KuberneteCilium
  public containerSsh: KuberneteContainerSSH

  constructor(
    name: string,
    args: Stack8KubernetesArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes", name, undefined, opts)

    this.opts = { ...opts, parent: this }
    this.k8sOpts = { ...this.opts, provider: args.k8sProvider }

    this.gatewayApi = new KuberneteGatewayApi("gateway-api", {}, this.k8sOpts)

    this.cilium = new KuberneteCilium(
      "cilium",
      {
        clusterEndpoint: args.aws.cluster.cluster.endpoint.apply(
          x => new URL(x).hostname,
        ),
        loadBalancerSubnetIds: pulumi
          .all(args.aws.network.publicSubnets.map(x => x.id))
          .apply(x => x.join(",")),
      },
      this.k8sOpts,
    )

    this.containerSsh = new KuberneteContainerSSH(
      "containerssh",
      {
        bastionOAuthRedirectDomain: args.bastionOAuthRedirectDomain,
        oauth: {
          issuer: args.aws.idp.issuer,
          clientId: args.aws.idp.bastionClient.id,
          clientSecret: args.aws.idp.bastionClient.clientSecret,
        },
      },
      this.k8sOpts,
    )

    this.externalDns = new KuberneteExternalDNS(
      "external-dns",
      {
        domainHostZoneMap: args.aws.dns.domainHostZoneMap,
        groupNameDistributionMap: args.aws.cdn.groupNameDistributionMap,
        oidcProvider: args.aws.cluster.oidcProvider,
        k8sProvider: args.k8sProvider,
      },
      this.opts,
    )

    this.aws = new KubernetesAWS("aws", args, {
      ...this.opts,
      dependsOn: [this.cilium, this.containerSsh],
    })
  }
}
