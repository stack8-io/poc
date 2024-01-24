import { z } from "zod"

export const AWSCloudFrontGroupSchema = z.object({
  name: z.string(),
  domains: z.array(z.string()),
})

export type AWSCloudFrontGroup = z.infer<typeof AWSCloudFrontGroupSchema>

export const AWSArgsSchema = z.object({
  availabilityZones: z.array(z.string()),
  cloudFrontGroups: z.array(AWSCloudFrontGroupSchema),
  loadBalancerDomain: z.string(),
  databasePassword: z.string(),
})

export type AWSArgs = z.infer<typeof AWSArgsSchema>

export const Stack8ArgsSchema = z.object({
  aws: AWSArgsSchema,
})

export type Stack8Args = z.infer<typeof Stack8ArgsSchema>
