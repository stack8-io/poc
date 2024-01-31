import * as command from "@pulumi/command"
import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"
import { stringify } from "yaml"

export type KuberneteContainerSSHArgs = {
  bastionOAuthRedirectDomain: string
  oauth: {
    issuer: pulumi.Input<string>
    clientId: pulumi.Input<string>
    clientSecret: pulumi.Input<string>
  }
}

export class KuberneteContainerSSH extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public namespace: k8s.core.v1.Namespace
  public guestsNamespace: k8s.core.v1.Namespace
  public hostkeySecret: k8s.core.v1.Secret

  constructor(
    name: string,
    args: KuberneteContainerSSHArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:ContainerSSH", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    this.namespace = new k8s.core.v1.Namespace(
      "namespace",
      {
        metadata: {
          name: "containerssh",
        },
      },
      this.opts,
    )

    this.guestsNamespace = new k8s.core.v1.Namespace(
      "guests-namespace",
      {
        metadata: {
          name: "containerssh-guests",
        },
      },
      this.opts,
    )

    const configMap = new k8s.core.v1.ConfigMap(
      "config-map",
      {
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "containerssh-config",
        },
        data: {
          "config.yaml": pulumi
            .all([
              args.oauth.clientId,
              args.oauth.clientSecret,
              args.oauth.issuer,
              this.guestsNamespace.metadata.name,
            ])
            .apply(([clientId, clientSecret, issuer, guestsNamespace]) => {
              return stringify({
                log: {
                  level: "debug",
                },
                ssh: {
                  hostkeys: ["/etc/containerssh/host.key"],
                },
                auth: {
                  // password: {
                  //   method: "webhook",
                  //   webhook: {
                  //     url: "https://ghastly-cool-chipmunk.ngrok-free.app",
                  //   },
                  // },
                  keyboardInteractive: {
                    method: "oauth2",
                    oauth2: {
                      clientId: clientId,
                      clientSecret: clientSecret,
                      provider: "oidc",
                      oidc: {
                        url: issuer,
                        authorizationCodeFlow: true,
                        redirectURI: `https://${args.bastionOAuthRedirectDomain}/`,
                      },
                    },
                  },
                },
                // NOTE: SSH_AUTH_UNAVAILABLE occurs when OAuth2 authentication and Audit logging are enabled
                // https://github.com/ContainerSSH/ContainerSSH/issues/586
                // audit: {
                //   enable: true,
                //   format: "binary",
                //   storage: "file",
                //   intercept: {
                //     stdin: true,
                //     stdout: true,
                //     stderr: true,
                //     passwords: true,
                //   },
                //   file: {
                //     directory: "/var/log/audit",
                //   },
                // },
                backend: "kubernetes",
                kubernetes: {
                  connection: {
                    host: "kubernetes.default.svc",
                    cacertFile:
                      "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
                    bearerTokenFile:
                      "/var/run/secrets/kubernetes.io/serviceaccount/token",
                  },
                  pod: {
                    metadata: {
                      namespace: guestsNamespace,
                    },
                    spec: {
                      containers: [
                        {
                          name: "shell",
                          image: "containerssh/containerssh-guest-image",
                        },
                      ],
                    },
                  },
                },
              })
            }),
        },
      },
      this.opts,
    )

    const hostkey = new command.local.Command(
      "hostkey",
      {
        create: "openssl genrsa",
      },
      { ...this.opts, provider: undefined },
    )

    this.hostkeySecret = new k8s.core.v1.Secret(
      "hostkey-secret",
      {
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "containerssh-hostkey",
        },
        data: {
          "host.key": hostkey.stdout.apply(x =>
            Buffer.from(x).toString("base64"),
          ),
        },
      },
      this.opts,
    )

    const sa = new k8s.core.v1.ServiceAccount(
      "sa",
      {
        metadata: {
          namespace: this.namespace.metadata.name,
          name: "containerssh",
        },
        automountServiceAccountToken: true,
      },
      this.opts,
    )

    const role = new k8s.rbac.v1.Role(
      "role",
      {
        metadata: {
          namespace: this.guestsNamespace.metadata.name,
          name: "containerssh",
        },
        rules: [
          {
            apiGroups: [""],
            resources: ["pods", "pods/logs", "pods/exec"],
            verbs: ["*"],
          },
        ],
      },
      this.opts,
    )

    const roleBinding = new k8s.rbac.v1.RoleBinding(
      "role-binding",
      {
        metadata: {
          namespace: this.guestsNamespace.metadata.name,
          name: "containerssh",
        },
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: role.kind,
          name: role.metadata.name,
        },
        subjects: [
          {
            kind: sa.kind,
            namespace: sa.metadata.namespace,
            name: sa.metadata.name,
          },
        ],
      },
      this.opts,
    )

    const labels = { app: "containerssh" }
    const deployment = new k8s.apps.v1.Deployment(
      "deployment",
      {
        metadata: {
          name: "containerssh",
          namespace: this.namespace.metadata.name,
          labels,
        },
        spec: {
          replicas: 1,
          selector: {
            matchLabels: labels,
          },
          template: {
            metadata: {
              labels,
            },
            spec: {
              serviceAccountName: sa.metadata.name,
              containers: [
                {
                  name: "containerssh",
                  image: "containerssh/containerssh:v0.5.0",
                  securityContext: {
                    readOnlyRootFilesystem: true,
                  },
                  ports: [
                    {
                      containerPort: 2222,
                    },
                  ],
                  volumeMounts: [
                    {
                      name: "hostkey",
                      mountPath: "/etc/containerssh/host.key",
                      subPath: "host.key",
                      readOnly: true,
                    },
                    {
                      name: "config",
                      mountPath: "/etc/containerssh/config.yaml",
                      subPath: "config.yaml",
                      readOnly: true,
                    },
                    {
                      name: "auditlog",
                      mountPath: "/var/log/audit",
                    },
                  ],
                },
              ],
              securityContext: {
                runAsNonRoot: true,
              },
              volumes: [
                {
                  name: "hostkey",
                  secret: {
                    secretName: this.hostkeySecret.metadata.name,
                  },
                },
                {
                  name: "config",
                  configMap: {
                    name: configMap.metadata.name,
                  },
                },
                {
                  name: "auditlog",
                  emptyDir: {},
                },
              ],
            },
          },
        },
      },
      this.opts,
    )

    const service = new k8s.core.v1.Service(
      "service",
      {
        metadata: {
          name: "containerssh",
          namespace: this.namespace.metadata.name,
        },
        spec: {
          selector: labels,
          ports: [
            {
              protocol: "TCP",
              port: 2222,
              targetPort: 2222,
            },
          ],
          type: "NodePort",
        },
      },
      this.opts,
    )
  }
}
