import { z } from "zod"

export const AWSCloudFrontGroupSchema = z.object({
  name: z.string(),
  domains: z.array(z.string()),
})

export type AWSCloudFrontGroup = z.infer<typeof AWSCloudFrontGroupSchema>

export const AWSUser = z.object({
  name: z.string().min(1).max(64),
  email: z.string().email(),
  roles: z.array(z.enum(["admin"])),
})

export const AWSArgsSchema = z.object({
  users: z.array(AWSUser),
  availabilityZones: z.array(z.string()),
  cloudFrontGroups: z.array(AWSCloudFrontGroupSchema),
  loadBalancerDomain: z.string(),
  databasePassword: z.string(),
  bastionOAuthRedirectDomain: z.string(),
})

export type AWSArgs = z.infer<typeof AWSArgsSchema>

export const Stack8ArgsSchema = z.object({
  aws: AWSArgsSchema,
})

export type Stack8Args = z.infer<typeof Stack8ArgsSchema>
