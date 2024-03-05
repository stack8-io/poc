import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import * as ipaddr from "ipaddr.js"
import * as R from "remeda"

/**
 * Calculate a single subnet address range from a given CIDR prefix
 *
 * @param prefix  The starting CIDR
 * @param newbits The number of additional bits to extend the prefix
 * @param netnum  A range index within the given CIDR
 */
export function cidrsubnet(
  prefix: pulumi.Output<string>,
  newbits: number,
  netnum: number,
): pulumi.Output<string> {
  return prefix.apply(x => {
    const [ip, mask] = ipaddr.parseCIDR(x) // returns [ip, bitcount]

    let binaryIP = ip
      .toByteArray()
      .map(byte => byte.toString(2).padStart(8, "0"))
      .join("")

    const binaryNetnum = netnum.toString(2).padStart(newbits, "0")

    binaryIP =
      binaryIP.slice(0, mask) + binaryNetnum + binaryIP.slice(mask + newbits)

    const newIPBytes = binaryIP
      .match(/.{8}/g)
      ?.map(binaryByte => parseInt(binaryByte, 2))

    if (newIPBytes === undefined) {
      throw new Error("Invalid IP address.")
    }

    const newIP = ipaddr.fromByteArray(newIPBytes)
    return `${newIP.toString()}/${mask + newbits}`
  })
}

export function getAvailabilityZoneSuffix<
  T extends string | pulumi.Output<string>,
>(zone: T): T {
  if (typeof zone === "string") {
    return (zone.split("-").at(-1) ?? "x") as T
  }
  return zone.apply(x => x.split("-").at(-1) ?? "x") as T
}

export function getResourceTags(name?: string) {
  const project = pulumi.getProject()
  const stack = pulumi.getStack()
  return {
    Name: name ? `s8-${project}-${stack}-${name}` : `s8-${project}-${stack}`,
    project,
    stack,
  }
}

export type HostZoneInfo = {
  hostZoneNames: Set<string>
  domainHostZoneMap: Map<string, string>
}

export function getHostZoneInfo(domains: string[]) {
  const orderedDomains = R.pipe(
    domains,
    R.uniq(),
    R.sortBy(x => {
      const m = x.match(/\./g)
      return m?.length ?? 0
    }),
  )

  return orderedDomains.reduce<HostZoneInfo>(
    (acc, x) => {
      const withoutWC = x.replace("*.", "")
      const ancestorDomains = withoutWC
        .split(".")
        .map((_, i, parts) => parts.slice(i).join("."))
        .reverse()
        .slice(1)
      for (const d of ancestorDomains) {
        if (acc.hostZoneNames.has(d)) {
          acc.domainHostZoneMap.set(x, d)
          return acc
        }
      }
      acc.hostZoneNames.add(withoutWC)
      acc.domainHostZoneMap.set(x, withoutWC)
      return acc
    },
    { hostZoneNames: new Set(), domainHostZoneMap: new Map() },
  )
}

export function getAssumeRoleForEKSPodIdentity(): aws.iam.PolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowEksAuthToAssumeRoleForPodIdentity",
        Effect: "Allow",
        Principal: {
          Service: "pods.eks.amazonaws.com",
        },
        Action: ["sts:AssumeRole", "sts:TagSession"],
      },
    ],
  }
}
