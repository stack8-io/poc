import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { AWSArgs } from "../schema"
import { cidrsubnet, getAvailabilityZoneSuffix, getResourceTags } from "../util"

export type AWSNetworkArgs = Pick<
  AWSArgs,
  "availabilityZones" | "loadBalancerDomain"
> & {
  loadBalancerCertificateArn: pulumi.Input<string>
  loadBalancerHostZoneId: pulumi.Input<string>
}

export enum SubnetType {
  Public = "public",
  Private = "private",
  Protected = "protected",
}

export class AWSNetwork extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public vpc: aws.ec2.Vpc
  public publicSubnets: aws.ec2.Subnet[]
  public privateSubnets: aws.ec2.Subnet[]
  public protectedSubnets: aws.ec2.Subnet[]
  public internetGateway: aws.ec2.InternetGateway
  public loadBalancer: aws.lb.LoadBalancer
  public loadBalancerTargetGroup: aws.lb.TargetGroup
  public publicSecurityGroup: aws.ec2.SecurityGroup
  public privateSecurityGroup: aws.ec2.SecurityGroup
  public protectedSecurityGroup: aws.ec2.SecurityGroup
  public egressOnlyInternetGateway: aws.ec2.EgressOnlyInternetGateway
  public natGateways: aws.ec2.NatGateway[]

  constructor(
    name: string,
    args: AWSNetworkArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:aws:Network", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.vpc = new aws.ec2.Vpc(
      "vpc",
      {
        cidrBlock: "10.0.0.0/16",
        enableDnsSupport: true,
        enableDnsHostnames: true,
        assignGeneratedIpv6CidrBlock: true,
        tags: getResourceTags(),
      },
      this.opts,
    )

    const publicResources = createPublicSubnetResources(
      this.vpc,
      args.availabilityZones,
      args.loadBalancerDomain,
      args.loadBalancerCertificateArn,
      args.loadBalancerHostZoneId,
      this.opts,
    )

    const privateResources = createPrivateSubnetResources(
      this.vpc,
      args.availabilityZones,
      this.opts,
      publicResources.natGateways,
      publicResources.sg,
    )

    const protectedResources = createProtectedSubnetResources(
      this.vpc,
      args.availabilityZones,
      privateResources.sg,
      this.opts,
    )

    this.publicSubnets = publicResources.subnets
    this.internetGateway = publicResources.igw
    this.loadBalancer = publicResources.nlb
    this.loadBalancerTargetGroup = publicResources.tg
    this.natGateways = publicResources.natGateways
    this.privateSubnets = privateResources.subnets
    this.egressOnlyInternetGateway = privateResources.egressOnlyInternetGateway
    this.protectedSubnets = protectedResources.subnets
    this.publicSecurityGroup = publicResources.sg
    this.privateSecurityGroup = privateResources.sg
    this.protectedSecurityGroup = protectedResources.sg
  }
}

function createPublicSubnetResources(
  vpc: aws.ec2.Vpc,
  availabilityZones: string[],
  loadBalancerDomainName: pulumi.Input<string>,
  loadBalancerCertificateArn: pulumi.Input<string>,
  loadBalancerHostZoneId: pulumi.Input<string>,
  opts: pulumi.ResourceOptions,
) {
  const tags = getResourceTags()
  const publicTags = getResourceTags("public")

  const subnets = createSubnets(
    vpc,
    availabilityZones,
    opts,
    SubnetType.Public,
    { "kubernetes.io/role/elb": "1" },
  )
  const igw = new aws.ec2.InternetGateway(
    "igw",
    {
      vpcId: vpc.id,
      tags,
    },
    opts,
  )
  const routeTable = new aws.ec2.RouteTable(
    "route-table-public",
    {
      routes: [
        {
          cidrBlock: "0.0.0.0/0",
          gatewayId: igw.id,
        },
        {
          ipv6CidrBlock: "::/0",
          gatewayId: igw.id,
        },
      ],
      vpcId: vpc.id,
      tags: publicTags,
    },
    opts,
  )
  createRouteTableAssociations(
    routeTable,
    subnets,
    SubnetType.Public,
    availabilityZones,
    opts,
  )
  const natGateways = subnets.map((subnet, index) => {
    const zoneSuffix = getAvailabilityZoneSuffix(availabilityZones[index])
    const eip = new aws.ec2.Eip(
      `eip-${zoneSuffix}`,
      {
        tags: getResourceTags(zoneSuffix),
      },
      opts,
    )
    const gateway = new aws.ec2.NatGateway(
      `nat-gateway-${zoneSuffix}`,
      {
        allocationId: eip.allocationId,
        subnetId: subnet.id,
      },
      opts,
    )
    return gateway
  })

  const sg = new aws.ec2.SecurityGroup(
    "security-group-public",
    {
      name: publicTags.Name,
      description: "Allow http(s)",
      vpcId: vpc.id,
      // FIXME: Restrict requests to only those from WAF
      ingress: [
        {
          fromPort: 443,
          toPort: 443,
          protocol: "tcp",
          cidrBlocks: ["0.0.0.0/0"],
          ipv6CidrBlocks: ["::/0"],
        },
      ],
      egress: [
        {
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          cidrBlocks: ["0.0.0.0/0"],
          ipv6CidrBlocks: ["::/0"],
        },
      ],
      tags: publicTags,
    },
    opts,
  )
  const nlb = new aws.lb.LoadBalancer(
    "nlb",
    {
      name: tags.Name,
      internal: false,
      loadBalancerType: "network",
      securityGroups: [sg.id],
      subnets: subnets.map(x => x.id),
      tags,
    },
    opts,
  )
  const tg = new aws.lb.TargetGroup(
    "target-group",
    {
      vpcId: vpc.id,
      targetType: "instance",
      protocol: "TCP",
      port: 80,
    },
    opts,
  )
  const listener = new aws.lb.Listener(
    "https-listner",
    {
      loadBalancerArn: nlb.arn,
      protocol: "TLS",
      port: 443,
      sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
      certificateArn: loadBalancerCertificateArn,
      defaultActions: [
        {
          type: "forward",
          targetGroupArn: tg.arn,
        },
      ],
    },
    opts,
  )
  const record = new aws.route53.Record(
    "nlb",
    {
      zoneId: loadBalancerHostZoneId,
      name: loadBalancerDomainName,
      type: "A",
      aliases: [
        {
          name: nlb.dnsName,
          zoneId: nlb.zoneId,
          evaluateTargetHealth: false,
        },
      ],
    },
    opts,
  )
  return { subnets, igw, natGateways, nlb, sg, tg, listener, record }
}

function createPrivateSubnetResources(
  vpc: aws.ec2.Vpc,
  availabilityZones: string[],
  opts: pulumi.ResourceOptions,
  natGateways: aws.ec2.NatGateway[],
  publicSecurityGroup: aws.ec2.SecurityGroup,
) {
  const subnets = createSubnets(
    vpc,
    availabilityZones,
    opts,
    SubnetType.Private,
    { "kubernetes.io/role/internal-elb": "1" },
  )
  const egressOnlyInternetGateway = new aws.ec2.EgressOnlyInternetGateway(
    "egress-only-igw",
    {
      vpcId: vpc.id,
      tags: getResourceTags(),
    },
    opts,
  )
  subnets.map((subnet, index) => {
    const zoneSuffix = getAvailabilityZoneSuffix(availabilityZones[index])
    const natGateway = natGateways[index]
    const routeTable = new aws.ec2.RouteTable(
      `route-table-private-${zoneSuffix}`,
      {
        routes: [
          {
            cidrBlock: "0.0.0.0/0",
            natGatewayId: natGateway.id,
          },
          {
            ipv6CidrBlock: "::/0",
            egressOnlyGatewayId: egressOnlyInternetGateway.id,
          },
        ],
        vpcId: vpc.id,
        tags: getResourceTags(`private-${zoneSuffix}`),
      },
      opts,
    )
    const association = new aws.ec2.RouteTableAssociation(
      `rt-associatio-private-${zoneSuffix}`,
      {
        routeTableId: routeTable.id,
        subnetId: subnet.id,
      },
      opts,
    )
    return { routeTable, association }
  })
  const tags = getResourceTags("private")
  const sg = new aws.ec2.SecurityGroup(
    "security-group-private",
    {
      name: tags.Name,
      vpcId: vpc.id,
      ingress: [
        {
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          self: true,
          securityGroups: [publicSecurityGroup.id],
        },
      ],
      egress: [
        {
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          cidrBlocks: ["0.0.0.0/0"],
          ipv6CidrBlocks: ["::/0"],
        },
      ],
      tags,
    },
    opts,
  )
  return { subnets, egressOnlyInternetGateway, sg }
}

function createProtectedSubnetResources(
  vpc: aws.ec2.Vpc,
  availabilityZones: string[],
  privateSecurityGroup: aws.ec2.SecurityGroup,
  opts: pulumi.ResourceOptions,
) {
  const subnets = createSubnets(
    vpc,
    availabilityZones,
    opts,
    SubnetType.Protected,
  )
  const tags = getResourceTags("protected")
  const routeTable = new aws.ec2.RouteTable(
    "route-table-protected",
    {
      routes: [],
      vpcId: vpc.id,
      tags,
    },
    opts,
  )
  createRouteTableAssociations(
    routeTable,
    subnets,
    SubnetType.Protected,
    availabilityZones,
    opts,
  )
  const sg = new aws.ec2.SecurityGroup(
    "security-group-protected",
    {
      name: tags.Name,
      vpcId: vpc.id,
      ingress: [
        {
          fromPort: 0,
          toPort: 0,
          protocol: "-1",
          self: true,
          securityGroups: [privateSecurityGroup.id],
        },
      ],
      tags,
    },
    opts,
  )
  return { subnets, sg }
}

function createSubnets(
  vpc: aws.ec2.Vpc,
  availabilityZones: string[],
  opts: pulumi.ResourceOptions,
  type: SubnetType,
  tags?: {
    [key: string]: pulumi.Input<string>
  },
) {
  const typeIndex = Object.values(SubnetType).indexOf(type)
  return availabilityZones.map((zone, zoneIndex) => {
    const cidrIndex = typeIndex * availabilityZones.length + zoneIndex
    const zoneSuffix = getAvailabilityZoneSuffix(zone)
    const nameSuffix = `${type}-${zoneSuffix}`
    return new aws.ec2.Subnet(
      `subnet-${nameSuffix}`,
      {
        cidrBlock: cidrsubnet(vpc.cidrBlock, 4, cidrIndex),
        ipv6CidrBlock: cidrsubnet(vpc.ipv6CidrBlock, 8, cidrIndex),
        assignIpv6AddressOnCreation: true,
        availabilityZone: zone,
        vpcId: vpc.id,
        tags: {
          ...getResourceTags(nameSuffix),
          ...tags,
        },
      },
      opts,
    )
  })
}

function createRouteTableAssociations(
  routeTable: aws.ec2.RouteTable,
  subnets: aws.ec2.Subnet[],
  type: SubnetType,
  availabilityZones: string[],
  opts: pulumi.ResourceOptions,
) {
  return subnets.map((subnet, index) => {
    const zoneSuffix = getAvailabilityZoneSuffix(availabilityZones[index])
    return new aws.ec2.RouteTableAssociation(
      `rt-associatio-${type}-${zoneSuffix}`,
      {
        routeTableId: routeTable.id,
        subnetId: subnet.id,
      },
      opts,
    )
  })
}
