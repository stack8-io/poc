import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { AWSArgs } from "../schema"
import { getResourceTags } from "../util"

export type AWSIdPArgs = Pick<
  AWSArgs,
  "users" | "bastionOAuthRedirectDomain" | "oneDevDomain" | "outlineDomain"
>

export class AWSIdP extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public userPool: aws.cognito.UserPool
  public userPoolDomain: aws.cognito.UserPoolDomain
  public bastionClient: aws.cognito.UserPoolClient
  public oneDevClient: aws.cognito.UserPoolClient
  public outlineClient: aws.cognito.UserPoolClient
  public adminGroup: aws.cognito.UserGroup
  public users: aws.cognito.User[]

  public get issuer() {
    return pulumi.interpolate`https://${this.userPool.endpoint}/`
  }

  public get discoveryEndpoint() {
    return `https://${this.userPool.endpoint}/.well-known/openid-configuration`
  }

  public get endpointDomain() {
    return pulumi.interpolate`${this.userPoolDomain.domain}.auth.${aws.config.region}.amazoncognito.com`
  }

  public get authEndpoint() {
    return pulumi.interpolate`https://${this.endpointDomain}/oauth2/authorize`
  }

  public get tokenEndpoint() {
    return pulumi.interpolate`https://${this.endpointDomain}/oauth2/token`
  }

  public get userinfoEndpoint() {
    return pulumi.interpolate`https://${this.endpointDomain}/oauth2/userInfo`
  }

  public getLogountEndpoint(clientId: pulumi.Input<string>) {
    return pulumi.interpolate`https://${this.endpointDomain}/logout?clientId=${clientId}`
  }

  constructor(name: string, args: AWSIdPArgs, opts?: pulumi.ResourceOptions) {
    super("stack8:aws:IdP", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    const tags = getResourceTags()
    this.userPool = new aws.cognito.UserPool(
      "user-pool",
      {
        name: tags.Name,
        aliasAttributes: ["email"],
        autoVerifiedAttributes: ["email"],
        adminCreateUserConfig: {
          allowAdminCreateUserOnly: true,
        },
        passwordPolicy: {
          minimumLength: 12,
          requireLowercase: true,
          requireNumbers: true,
          requireSymbols: true,
          requireUppercase: true,
          temporaryPasswordValidityDays: 7,
        },
        schemas: [
          {
            name: "email",
            attributeDataType: "String",
            developerOnlyAttribute: false,
            mutable: true,
            required: true,
            stringAttributeConstraints: {
              maxLength: "2048",
              minLength: "0",
            },
          },
        ],
        tags,
      },
      this.opts,
    )

    this.userPoolDomain = new aws.cognito.UserPoolDomain(
      "user-pool-domain",
      {
        userPoolId: this.userPool.id,
        domain: tags.Name,
      },
      this.opts,
    )

    this.bastionClient = new aws.cognito.UserPoolClient(
      "bastion-client",
      {
        name: "bastion",
        userPoolId: this.userPool.id,
        preventUserExistenceErrors: "ENABLED",
        allowedOauthFlowsUserPoolClient: true,
        allowedOauthFlows: ["code"],
        explicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
        supportedIdentityProviders: ["COGNITO"],
        allowedOauthScopes: ["email", "openid"],
        callbackUrls: [`https://${args.bastionOAuthRedirectDomain}/`],
        defaultRedirectUri: `https://${args.bastionOAuthRedirectDomain}/`,
        generateSecret: true,
      },
      { ...this.opts },
    )

    this.oneDevClient = new aws.cognito.UserPoolClient(
      "onedev-client",
      {
        name: "onedev",
        userPoolId: this.userPool.id,
        preventUserExistenceErrors: "ENABLED",
        allowedOauthFlowsUserPoolClient: true,
        allowedOauthFlows: ["code"],
        explicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
        supportedIdentityProviders: ["COGNITO"],
        allowedOauthScopes: ["email", "openid", "profile"],
        callbackUrls: [`https://${args.oneDevDomain}/~sso/callback/cognito`],
        defaultRedirectUri: `https://${args.oneDevDomain}/~sso/callback/cognito`,
        generateSecret: true,
      },
      { ...this.opts },
    )

    this.outlineClient = new aws.cognito.UserPoolClient(
      "outline-client",
      {
        name: "outline",
        userPoolId: this.userPool.id,
        preventUserExistenceErrors: "ENABLED",
        allowedOauthFlowsUserPoolClient: true,
        allowedOauthFlows: ["code"],
        explicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
        supportedIdentityProviders: ["COGNITO"],
        allowedOauthScopes: ["email", "openid", "profile"],
        callbackUrls: [`https://${args.outlineDomain}/auth/oidc.callback`],
        defaultRedirectUri: `https://${args.outlineDomain}/auth/oidc.callback`,
        generateSecret: true,
      },
      { ...this.opts },
    )

    this.adminGroup = new aws.cognito.UserGroup(
      "admin-user-group",
      {
        name: "admin",
        userPoolId: this.userPool.id,
      },
      this.opts,
    )

    this.users = args.users.map(x => {
      return new aws.cognito.User(
        `user-${x.name}`,
        {
          userPoolId: this.userPool.id,
          username: x.name,
          attributes: {
            email: x.email,
            email_verified: "true",
          },
        },
        this.opts,
      )
    })

    const admins = args.users.filter(x => x.roles.includes("admin"))

    admins.map(x => {
      return new aws.cognito.UserInGroup(
        `user-in-admin-group-${x.name}`,
        {
          userPoolId: this.userPool.id,
          groupName: this.adminGroup.name,
          username: x.name,
        },
        this.opts,
      )
    })
  }
}
