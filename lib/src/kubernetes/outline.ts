import * as aws from "@pulumi/aws"
import * as command from "@pulumi/command"
import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"
import { getResourceTags } from "../util"

export type KubernetesOutlineArgs = {
  k8sProvider: k8s.Provider
  domain: pulumi.Input<string>
  oidc: {
    clinetId: pulumi.Input<string>
    clientSecret: pulumi.Input<string>
    authUri: pulumi.Input<string>
    tokenUri: pulumi.Input<string>
    userinfoUri: pulumi.Input<string>
    logoutUri: pulumi.Input<string>
  }
}

export class KubernetesOutline extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public k8sOpts: pulumi.ResourceOptions
  public namespace: k8s.core.v1.Namespace
  public bucket: aws.s3.Bucket
  public bucketAccessUser: aws.iam.User
  public dragonfly: k8s.apiextensions.CustomResource

  constructor(
    name: string,
    args: KubernetesOutlineArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:Outline", name, undefined, opts)

    this.opts = { ...opts, parent: this }
    this.k8sOpts = { ...this.opts, provider: args.k8sProvider }

    this.namespace = new k8s.core.v1.Namespace(
      "namespace",
      {
        metadata: {
          name: "outline",
        },
      },
      this.k8sOpts,
    )

    const tags = getResourceTags("outline")

    this.bucket = new aws.s3.Bucket(
      "bucket",
      {
        bucket: tags.Name,
        tags,
      },
      this.opts,
    )

    const bucketPublicAccessBlock = new aws.s3.BucketPublicAccessBlock(
      "bucket-public-access-block",
      {
        bucket: this.bucket.id,
        blockPublicPolicy: true,
        blockPublicAcls: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      this.opts,
    )

    const cors = new aws.s3.BucketCorsConfigurationV2(
      "cros-configuration",
      {
        bucket: this.bucket.id,
        corsRules: [
          {
            allowedHeaders: ["*"],
            allowedMethods: ["PUT", "POST"],
            allowedOrigins: [pulumi.interpolate`https://${args.domain}`],
            exposeHeaders: [],
          },
          {
            allowedHeaders: [""],
            allowedMethods: ["GET"],
            allowedOrigins: ["*"],
            exposeHeaders: [],
          },
        ],
      },
      this.opts,
    )

    this.bucketAccessUser = new aws.iam.User(
      "bucket-access-user",
      {
        name: "bucket-access-user",
      },
      this.opts,
    )

    const policy = new aws.iam.Policy(
      "policy",
      {
        name: tags.Name,
        policy: this.bucket.arn.apply(bucketArn =>
          aws.iam.getPolicyDocument({
            statements: [
              {
                effect: "Allow",
                actions: [
                  "s3:GetObjectAcl",
                  "s3:DeleteObject",
                  "s3:PutObject",
                  "s3:GetObject",
                  "s3:PutObjectAcl",
                ],
                resources: [`${bucketArn}/*`],
              },
            ],
          }),
        ).json,
        tags,
      },
      this.opts,
    )

    const policyAttachment = new aws.iam.UserPolicyAttachment(
      "policy-attachment",
      {
        user: this.bucketAccessUser.id,
        policyArn: policy.arn,
      },
      this.opts,
    )

    const accessKey = new aws.iam.AccessKey(
      "access-key",
      {
        user: this.bucketAccessUser.name,
      },
      this.opts,
    )

    // const dragonflyPassword = new k8s.apiextensions.CustomResource(
    //   "dragonfly-password",
    //   {
    //     apiVersion: "generators.external-secrets.io/v1alpha1",
    //     kind: "Password",
    //     metadata: {
    //       namespace: this.namespace.metadata.name,
    //       name: "dragonfly",
    //     },
    //     spec: {
    //       symbolCharacters: "._-",
    //       allowRepeat: true,
    //     },
    //   },
    //   this.k8sOpts,
    // )

    // const dragonflySecret = new k8s.apiextensions.CustomResource(
    //   "dragonfly-secret",
    //   {
    //     apiVersion: "external-secrets.io/v1beta1",
    //     kind: "ExternalSecret",
    //     metadata: {
    //       namespace: this.namespace.metadata.name,
    //       name: "dragonfly",
    //     },
    //     spec: {
    //       target: {
    //         name: "dragonfly-secret",
    //       },
    //       dataFrom: [
    //         {
    //           sourceRef: {
    //             generatorRef: {
    //               apiVersion: dragonflyPassword.apiVersion,
    //               kind: dragonflyPassword.kind,
    //               name: dragonflyPassword.metadata.name,
    //             },
    //           },
    //         },
    //       ],
    //     },
    //   },
    //   this.k8sOpts,
    // )

    this.dragonfly = new k8s.apiextensions.CustomResource(
      "dragonfly",
      {
        apiVersion: "dragonflydb.io/v1alpha1",
        kind: "Dragonfly",
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "dragonfly",
        },
        spec: {
          // authentication: {
          //   passwordFromSecret: {
          //     name: "dragonfly-secret",
          //     key: "password",
          //   },
          // },
          replicas: 1,
          args: [
            "--maxmemory",
            "256mb",
            "--proactor_threads",
            "1",
            // NOTE: Because Outline uses Bull, this flag is required.
            "--default_lua_flags",
            "allow-undeclared-keys",
          ],
          resources: {
            limits: {
              cpu: "100m",
            },
          },
        },
      },
      this.k8sOpts,
    )

    const postgresDatabse = new k8s.apiextensions.CustomResource(
      "postgres-database",
      {
        apiVersion: "db.movetokube.com/v1alpha1",
        kind: "Postgres",
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "outline",
        },
        spec: {
          database: "outline",
          dropOnDelete: true,
          extensions: ["pgcrypto", "pg_bigm"],
        },
      },
      this.k8sOpts,
    )

    const postgresUser = new k8s.apiextensions.CustomResource(
      "postgres-user",
      {
        apiVersion: "db.movetokube.com/v1alpha1",
        kind: "PostgresUser",
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "outline",
        },
        spec: {
          role: "outline",
          database: "outline",
          secretName: "postgres-secret",
          privileges: "OWNER",
        },
      },
      this.k8sOpts,
    )

    const outlineSecretKey = new command.local.Command(
      "secret-key",
      {
        create: "openssl rand -hex 32",
      },
      { ...this.opts, provider: undefined },
    )

    const outlineUtilsSecret = new command.local.Command(
      "utils-secret",
      {
        create: "openssl rand -hex 32",
      },
      { ...this.opts, provider: undefined },
    )

    const secret = new k8s.core.v1.Secret(
      "secret",
      {
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "outline",
        },
        stringData: {
          NODE_ENV: "production",
          SECRET_KEY: outlineSecretKey.stdout,
          UTILS_SECRET: outlineUtilsSecret.stdout,
          // DATABASE_URL:
          DATABASE_CONNECTION_POOL_MIN: "",
          DATABASE_CONNECTION_POOL_MAX: "",
          // REDIS_URL:
          URL: pulumi.interpolate`https://${args.domain}`,
          PORT: "3000",
          COLLABORATION_URL: "",
          AWS_ACCESS_KEY_ID: accessKey.id,
          AWS_SECRET_ACCESS_KEY: accessKey.secret,
          // biome-ignore lint/style/noNonNullAssertion:
          AWS_REGION: aws.config.region!,
          AWS_S3_ACCELERATE_URL: "",
          AWS_S3_UPLOAD_BUCKET_URL: pulumi.interpolate`https://${this.bucket.bucketRegionalDomainName}`,
          AWS_S3_UPLOAD_BUCKET_NAME: this.bucket.bucket,
          AWS_S3_FORCE_PATH_STYLE: "false",
          FILE_STORAGE: "s3",
          OIDC_CLIENT_ID: args.oidc.clinetId,
          OIDC_CLIENT_SECRET: args.oidc.clientSecret,
          OIDC_AUTH_URI: args.oidc.authUri,
          OIDC_TOKEN_URI: args.oidc.tokenUri,
          OIDC_USERINFO_URI: args.oidc.userinfoUri,
          OIDC_LOGOUT_URI: args.oidc.logoutUri,
          OIDC_USERNAME_CLAIM: "preferred_username",
          OIDC_DISPLAY_NAME: "OpenID Connect",
          OIDC_SCOPES: "openid profile email",
          FORCE_HTTPS: "false",
        },
      },
      this.k8sOpts,
    )

    const deployment = new k8s.apps.v1.Deployment(
      "deployment",
      {
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "outline",
        },
        spec: {
          selector: {
            matchLabels: {
              app: "outline",
            },
          },
          template: {
            metadata: {
              labels: {
                app: "outline",
              },
            },
            spec: {
              containers: [
                {
                  name: "outline",
                  image: "docker.getoutline.com/outlinewiki/outline:0.75.2",
                  envFrom: [
                    {
                      secretRef: {
                        name: secret.metadata.name,
                      },
                    },
                  ],
                  env: [
                    {
                      name: "DATABASE_URL",
                      valueFrom: {
                        secretKeyRef: {
                          name: "postgres-secret-outline",
                          key: "POSTGRES_URL",
                        },
                      },
                    },
                    // {
                    //   name: "REDIS_PASSWORD",
                    //   valueFrom: {
                    //     secretKeyRef: {
                    //       name: "dragonfly-secret",
                    //       key: "password",
                    //     },
                    //   },
                    // },
                    {
                      name: "REDIS_URL",
                      // value: "redis://:$(REDIS_PASSWORD)@dragonfly/0",
                      value: "redis://dragonfly/0",
                    },
                  ],
                },
              ],
            },
          },
        },
      },
      this.k8sOpts,
    )

    const service = new k8s.core.v1.Service(
      "service",
      {
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "outline",
          labels: {
            app: "outline",
          },
        },
        spec: {
          selector: {
            app: "outline",
          },
          ports: [
            {
              port: 3000,
              protocol: "TCP",
            },
          ],
          type: "ClusterIP",
        },
      },
      this.k8sOpts,
    )

    const httpRoute = new k8s.apiextensions.CustomResource(
      "http-route",
      {
        apiVersion: "gateway.networking.k8s.io/v1beta1",
        kind: "HTTPRoute",
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "outline",
        },
        spec: {
          parentRefs: [
            {
              name: "gateway",
              namespace: "kube-system",
            },
          ],
          hostnames: [args.domain],
          rules: [
            {
              backendRefs: [
                {
                  name: "outline",
                  port: 3000,
                },
              ],
            },
          ],
        },
      },
      this.k8sOpts,
    )
  }
}
