import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"

export type KuberneteCiliumArgs = {
  clusterEndpoint: pulumi.Input<string>
  loadBalancerSubnetIds: pulumi.Input<string>
}

export class KuberneteCilium extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public release: k8s.helm.v3.Release
  public gateway: k8s.apiextensions.CustomResource

  constructor(
    name: string,
    args: KuberneteCiliumArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:Cilium", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    const disabledAWSNode = new k8s.apps.v1.DaemonSetPatch(
      "disabled-aws-node",
      {
        metadata: {
          namespace: "kube-system",
          name: "aws-node",
        },
        spec: {
          template: {
            spec: {
              nodeSelector: {
                node: "non-existing",
              },
            },
          },
        },
      },
      this.opts,
    )

    const disabledKubeProxy = new k8s.apps.v1.DaemonSetPatch(
      "disabled-kube-proxy",
      {
        metadata: {
          namespace: "kube-system",
          name: "kube-proxy",
        },
        spec: {
          template: {
            spec: {
              nodeSelector: {
                node: "non-existing",
              },
            },
          },
        },
      },
      this.opts,
    )

    this.release = new k8s.helm.v3.Release(
      "release",
      {
        chart: "cilium",
        namespace: "kube-system",
        version: "v1.14.5",
        repositoryOpts: {
          repo: "https://helm.cilium.io/",
        },
        values: {
          // NOTE: For running in EKS
          eni: {
            enabled: true,
            awsEnablePrefixDelegation: true,
          },
          ipam: {
            mode: "eni",
          },
          egressMasqueradeInterfaces: "eth0",
          routingMode: "native",
          // NOTE: For replacing kube-proxy with eBPF
          kubeProxyReplacement: true,
          k8sServiceHost: args.clusterEndpoint,
          k8sServicePort: "443",
          // NOTE: For enabling GatewayAPI
          gatewayAPI: {
            enabled: true,
          },
          // NOTE: For enabling Hubble Observability
          hubble: {
            relay: {
              enabled: true,
            },
            ui: {
              enabled: true,
            },
          },
          // NOTE: For getting better performance
          loadBalancer: {
            algorithm: "maglev",
          },
        },
      },
      {
        ...this.opts,
        dependsOn: [disabledAWSNode, disabledKubeProxy],
        // FIXME: 常に差分として出てくるので一旦コメントアウト。調べてほしい。
        ignoreChanges: ["checksum"],
      },
    )

    this.gateway = new k8s.apiextensions.CustomResource(
      "gateway",
      {
        apiVersion: "gateway.networking.k8s.io/v1beta1",
        kind: "Gateway",
        metadata: {
          namespace: "kube-system",
          name: "gateway",
          annotations: {
            // NOTE:
            // This value will be overridden by `default-targets` set in external-dns pods.
            // It is set because no DNS records are generated without the provisional value.
            "external-dns.alpha.kubernetes.io/target": "non-existing.com",
          },
        },
        spec: {
          gatewayClassName: "cilium",
          listeners: [
            {
              name: "http",
              port: 80,
              protocol: "HTTP",
              allowedRoutes: {
                namespaces: {
                  from: "All",
                },
              },
            },
          ],
        },
      },
      this.opts,
    )
  }
}
