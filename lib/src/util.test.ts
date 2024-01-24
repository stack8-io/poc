import * as pulumi from "@pulumi/pulumi"
import { describe, expect, it } from "vitest"
import { cidrsubnet, getHostZoneInfo } from "./util"

describe("cidrsubnet", () => {
  it("returns valid cidr", () => {
    const cidr0 = cidrsubnet(pulumi.Output.create("172.16.0.0/12"), 4, 2)
    cidr0.apply(x => {
      expect(x).toBe("172.18.0.0/16")
    })
    const cidr1 = cidrsubnet(pulumi.Output.create("10.1.2.0/24"), 4, 15)
    cidr1.apply(x => {
      expect(x).toBe("10.1.2.240/28")
    })
    const cidr2 = cidrsubnet(
      pulumi.Output.create("fd00:fd12:3456:7890::/56"),
      16,
      162,
    )
    cidr2.apply(x => {
      expect(x).toBe("fd00:fd12:3456:7800:a200::/72")
    })
  })
})

describe("getHostZoneInfo", () => {
  it("returns minium host zone names", () => {
    expect(
      getHostZoneInfo(["a.com", "x.a.com", "*.a.com", "*.b.com", "x.c.com"]),
    ).toEqual({
      domainHostZoneMap: new Map<string, string>([
        ["a.com", "a.com"],
        ["x.a.com", "a.com"],
        ["*.a.com", "a.com"],
        ["*.b.com", "b.com"],
        ["x.c.com", "x.c.com"],
      ]),
      hostZoneNames: new Set<string>(["a.com", "b.com", "x.c.com"]),
    })

    expect(
      getHostZoneInfo([
        "a.com",
        "*.a.com",
        "lb.a.com",
      ]),
    ).toEqual({
      domainHostZoneMap: new Map<string, string>([]),
      hostZoneNames: new Set<string>([]),
    })
  })
})
