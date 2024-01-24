import * as pulumi from "@pulumi/pulumi"
import { AWSArgs, Stack8 } from "@stack8/poc"

const config = new pulumi.Config()
const awsArgs = config.requireObject<AWSArgs>("aws")

const stack = new Stack8("stack8", {
  aws: awsArgs,
})

export const dns = Array.from(stack.aws.dns.domainHostZoneMap)
