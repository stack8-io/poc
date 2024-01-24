import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import * as R from "remeda"
import { AWSArgs } from "../schema"
import { HostZoneInfo, getHostZoneInfo, getResourceTags } from "../util"

export type AWSDNSArgs = Pick<
  AWSArgs,
  "cloudFrontGroups" | "loadBalancerDomain"
>

export class AWSDNS extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public domainHostZoneMap: Map<string, aws.route53.Zone>
  public cloudFrontGroupNameCertificateMap: Map<string, aws.acm.Certificate>
  public loadBalancerCertificate: aws.acm.Certificate
  public loadBalancerHostZone: aws.route53.Zone

  constructor(name: string, args: AWSDNSArgs, opts?: pulumi.ResourceOptions) {
    super("stack8:aws:DNS", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    const usProvider = new aws.Provider(
      "us",
      {
        profile: aws.config.profile,
        region: "us-east-1",
      },
      this.opts,
    )

    const zoneInfo = getHostZoneInfo(
      R.flatten([
        ...args.cloudFrontGroups.map(x => x.domains),
        args.loadBalancerDomain,
      ]),
    )

    this.domainHostZoneMap = new Map(
      Array.from(zoneInfo.hostZoneNames).map(domain => {
        const name = domain.replaceAll(".", "-")
        const tags = getResourceTags(name)
        return [
          domain,
          new aws.route53.Zone(
            name,
            {
              name: domain,
              tags,
            },
            this.opts,
          ),
        ]
      }),
    )

    this.cloudFrontGroupNameCertificateMap = new Map(
      args.cloudFrontGroups.map(x => {
        const tags = getResourceTags(x.name)
        return [
          x.name,
          new aws.acm.Certificate(
            x.name,
            {
              domainName: x.domains[0],
              subjectAlternativeNames: x.domains.slice(1),
              validationMethod: "DNS",
              tags,
            },
            { ...this.opts, provider: usProvider },
          ),
        ]
      }),
    )

    for (const [
      groupName,
      certificate,
    ] of this.cloudFrontGroupNameCertificateMap.entries()) {
      createCertificateValidation(
        groupName,
        certificate,
        this.domainHostZoneMap,
        zoneInfo,
        this.opts,
        usProvider,
      )
    }

    this.loadBalancerCertificate = new aws.acm.Certificate(
      "lb",
      {
        domainName: args.loadBalancerDomain,
        validationMethod: "DNS",
        tags: getResourceTags("lb"),
      },
      this.opts,
    )

    createCertificateValidation(
      "lb",
      this.loadBalancerCertificate,
      this.domainHostZoneMap,
      zoneInfo,
      this.opts,
    )

    const lbHostZoneName = zoneInfo.domainHostZoneMap.get(
      args.loadBalancerDomain,
    )
    const lbHostZone = this.domainHostZoneMap.get(lbHostZoneName ?? "")
    if (!lbHostZone) {
      throw new Error("DomainHostZoneMap value is unexpected.")
    }
    this.loadBalancerHostZone = lbHostZone
  }
}

export function createCertificateValidation(
  groupName: string,
  certificate: aws.acm.Certificate,
  domainHostZoneMap: Map<string, aws.route53.Zone>,
  zoneInfo: HostZoneInfo,
  opts: pulumi.ResourceOptions,
  provider?: aws.Provider,
) {
  const records = certificate.domainValidationOptions.apply(options => {
    return R.uniqBy(options, x => x.resourceRecordName).map((option, index) => {
      const hostZoneName = zoneInfo.domainHostZoneMap.get(option.domainName)
      const zoneId = domainHostZoneMap.get(hostZoneName ?? "")?.zoneId
      if (!zoneId) {
        throw new Error("DomainHostZoneMap value is unexpected.")
      }
      return new aws.route53.Record(
        `${groupName}-${index}`,
        {
          zoneId,
          ttl: 60,
          allowOverwrite: true,
          name: option.resourceRecordName,
          type: option.resourceRecordType,
          records: [option.resourceRecordValue],
        },
        opts,
      )
    })
  })

  return new aws.acm.CertificateValidation(
    groupName,
    {
      certificateArn: certificate.arn,
      validationRecordFqdns: records.apply(x => x.map(record => record.fqdn)),
    },
    { ...opts, provider },
  )
}
