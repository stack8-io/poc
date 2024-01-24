import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { AWSArgs } from "../schema"
import { getAvailabilityZoneSuffix, getResourceTags } from "../util"

export type AWSDatabseArgs = Pick<
  AWSArgs,
  "availabilityZones" | "databasePassword"
> & {
  subnetIds: pulumi.Input<pulumi.Input<string>[]>
  securityGroupId: pulumi.Input<string>
}

export class AWSDatabase extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public cluster: aws.rds.Cluster
  public clusterInstances: aws.rds.ClusterInstance[]

  constructor(
    name: string,
    args: AWSDatabseArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:aws:Database", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    const tags = getResourceTags()

    const subnetGroup = new aws.rds.SubnetGroup(
      "subnet-group",
      {
        name: tags.Name,
        subnetIds: args.subnetIds,
        tags,
      },
      this.opts,
    )

    const clusterParameterGroupTags = getResourceTags("cluster")
    const clusterParameterGroup = new aws.rds.ParameterGroup(
      "cluster-parameter-group",
      {
        name: clusterParameterGroupTags.Name,
        family: "aurora-postgresql15",
        tags: clusterParameterGroupTags,
      },
      this.opts,
    )

    this.cluster = new aws.rds.Cluster(
      "cluster",
      {
        engine: "aurora-postgresql",
        engineMode: "provisioned",
        dbSubnetGroupName: subnetGroup.name,
        clusterIdentifier: tags.Name,
        engineVersion: "15.4",
        databaseName: "postgres",
        masterUsername: "postgres",
        masterPassword: args.databasePassword,
        // NOTE:
        // DBClusterParameterGroupNotFound エラーが出て通らないので一旦コメントアウト
        // 参考情報を見ても指定の方法は間違ってなさそうなので、aws-nativeを使うのもありかも
        // dbClusterParameterGroupName: clusterParameterGroup.name,
        serverlessv2ScalingConfiguration: {
          maxCapacity: 1,
          minCapacity: 0.5,
        },
        iamDatabaseAuthenticationEnabled: true,
        vpcSecurityGroupIds: [args.securityGroupId],
        tags,
      },
      this.opts,
    )

    const instanceParameterGroupTags = getResourceTags("instance")
    const instanceParameterGroup = new aws.rds.ParameterGroup(
      "instance-parameter-group",
      {
        name: instanceParameterGroupTags.Name,
        family: "aurora-postgresql15",
        tags: instanceParameterGroupTags,
      },
      this.opts,
    )

    this.clusterInstances = args.availabilityZones.map(zone => {
      const zoneSuffix = getAvailabilityZoneSuffix(zone)
      const tags = getResourceTags(zoneSuffix)
      return new aws.rds.ClusterInstance(
        `cluster-instance-${zoneSuffix}`,
        {
          availabilityZone: zone,
          identifier: tags.Name,
          clusterIdentifier: this.cluster.id,
          engine: this.cluster.engine as pulumi.Input<aws.rds.EngineType>,
          engineVersion: this.cluster.engineVersion,
          instanceClass: "db.serverless",
          publiclyAccessible: false,
          dbParameterGroupName: instanceParameterGroup.name,
          dbSubnetGroupName: subnetGroup.name,
          caCertIdentifier: "rds-ca-rsa2048-g1",
          tags,
        },
        this.opts,
      )
    })
  }
}
