import * as pulumi from "@pulumi/pulumi"
import { AWSArgs } from "../schema"
import { AWSCDN } from "./cdn"
import { AWSCluster } from "./cluster"
import { AWSDatabase } from "./database"
import { AWSDNS } from "./dns"
import { AWSIdP } from "./idp"
import { AWSNetwork } from "./network"

export type Stack8AWSArgs = AWSArgs

export class Stack8AWS extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public dns: AWSDNS
  public cdn: AWSCDN
  public network: AWSNetwork
  public cluster: AWSCluster
  public database: AWSDatabase
  public idp: AWSIdP

  constructor(
    name: string,
    args: Stack8AWSArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:aws", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.dns = new AWSDNS("dns", args, this.opts)

    this.cdn = new AWSCDN("cdn", {
      ...args,
      cloudFrontGroupNameCertificateMap:
        this.dns.cloudFrontGroupNameCertificateMap,
    })

    this.network = new AWSNetwork(
      "newtork",
      {
        ...args,
        loadBalancerCertificateArn: this.dns.loadBalancerCertificate.arn,
        loadBalancerHostZoneId: this.dns.loadBalancerHostZone.zoneId,
      },
      this.opts,
    )

    const publicSubnetIds = this.network.publicSubnets.map(x => x.id)
    const privateSubnetIds = this.network.privateSubnets.map(x => x.id)
    const protectedSubnetIds = this.network.privateSubnets.map(x => x.id)

    this.cluster = new AWSCluster(
      "cluster",
      {
        vpcId: this.network.vpc.id,
        clusterSubnetIds: [...publicSubnetIds, ...privateSubnetIds],
        nodeGroupSubnetIds: privateSubnetIds,
        nodeSecurityGroupId: this.network.privateSecurityGroup.id,
      },
      this.opts,
    )

    this.database = new AWSDatabase(
      "database",
      {
        ...args,
        subnetIds: protectedSubnetIds,
        securityGroupId: this.network.protectedSecurityGroup.id,
      },
      this.opts,
    )

    this.idp = new AWSIdP(
      "idp",
      {
        ...args,
      },
      this.opts,
    )
  }
}
