import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { AWSArgs } from "../schema"
import { getResourceTags } from "../util"

export type AWSCDNArgs = Pick<
  AWSArgs,
  "cloudFrontGroups" | "loadBalancerDomain"
> & {
  cloudFrontGroupNameCertificateMap: Map<string, aws.acm.Certificate>
}

export class AWSCDN extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public groupNameDistributionMap: Map<string, aws.cloudfront.Distribution>

  constructor(name: string, args: AWSCDNArgs, opts?: pulumi.ResourceOptions) {
    super("stack8:aws:CDN", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    const usProvider = new aws.Provider(
      "us",
      {
        profile: aws.config.profile,
        region: "us-east-1",
      },
      this.opts,
    )

    this.groupNameDistributionMap = new Map(
      args.cloudFrontGroups.map(group => {
        const certificate = args.cloudFrontGroupNameCertificateMap.get(
          group.name,
        )
        if (!certificate) {
          throw new Error(
            "CloudFrontGroupNameCertificateMap value is unexpected.",
          )
        }

        const tags = getResourceTags(group.name)
        const cachePolicy = new aws.cloudfront.CachePolicy(
          `cache-policy-${group.name}`,
          {
            name: tags.Name,
            parametersInCacheKeyAndForwardedToOrigin: {
              queryStringsConfig: {
                queryStringBehavior: "all",
              },
              headersConfig: {
                headerBehavior: "whitelist",
                headers: {
                  items: ["host"],
                },
              },
              cookiesConfig: {
                cookieBehavior: "none",
              },
              enableAcceptEncodingBrotli: true,
              enableAcceptEncodingGzip: true,
            },
          },
          { ...this.opts, provider: usProvider },
        )
        const requestPolicy = new aws.cloudfront.OriginRequestPolicy(
          `request-policy-${group.name}`,
          {
            name: tags.Name,
            queryStringsConfig: {
              queryStringBehavior: "all",
            },
            headersConfig: {
              headerBehavior: "allViewer",
            },
            cookiesConfig: {
              cookieBehavior: "all",
            },
          },
          { ...this.opts, provider: usProvider },
        )
        const distribution = new aws.cloudfront.Distribution(
          `distribution-${group.name}`,
          {
            enabled: true,
            aliases: group.domains,
            viewerCertificate: {
              acmCertificateArn: certificate.arn,
              sslSupportMethod: "sni-only",
              minimumProtocolVersion: "TLSv1.2_2021",
            },
            httpVersion: "http2and3",
            origins: [
              {
                originId: "nlb",
                domainName: args.loadBalancerDomain,
                customOriginConfig: {
                  httpPort: 80,
                  httpsPort: 443,
                  originSslProtocols: ["TLSv1.2"],
                  originProtocolPolicy: "https-only",
                },
              },
            ],
            defaultCacheBehavior: {
              targetOriginId: "nlb",
              cachePolicyId: cachePolicy.id,
              originRequestPolicyId: requestPolicy.id,
              allowedMethods: [
                "GET",
                "HEAD",
                "OPTIONS",
                "PUT",
                "POST",
                "PATCH",
                "DELETE",
              ],
              cachedMethods: ["GET", "HEAD", "OPTIONS"],
              viewerProtocolPolicy: "redirect-to-https",
              compress: true,
            },
            restrictions: {
              geoRestriction: {
                restrictionType: "none",
              },
            },
            tags,
          },
          { ...this.opts, provider: usProvider },
        )
        return [group.name, distribution]
      }),
    )
  }
}
