import * as k8s from "@pulumi/kubernetes"
import * as pulumi from "@pulumi/pulumi"
import { Stack8AWS } from "../../aws/stack"
import { KubernetesAWSAmazonCloudwatchObservability } from "./amazonCloudwatchObservability"
import { KubernetesAWSAmazonEBSCSIDriver } from "./amazonEbsCsiDriver"
import { KubernetesAWSLoadBalancerController } from "./awsLoadBalancerController"
import { KubernetesAWSCoreDns } from "./coreDns"
import { KubernetesAWSEKSPodIdentityAgent } from "./eksPodIdentityAgent"

export type KubernetesAWSArgs = {
  aws: Stack8AWS
  k8sProvider: k8s.Provider
}

export class KubernetesAWS extends pulumi.ComponentResource {
  public opts: pulumi.ResourceOptions
  public coreDns: KubernetesAWSCoreDns
  public awsLoadBalancerController: KubernetesAWSLoadBalancerController
  public amazonCloudwatchObservability: KubernetesAWSAmazonCloudwatchObservability
  public amazonEBSCSIDriver: KubernetesAWSAmazonEBSCSIDriver
  public eksPodIdentityAgent: KubernetesAWSEKSPodIdentityAgent

  constructor(
    name: string,
    args: KubernetesAWSArgs,
    opts?: pulumi.ResourceOptions,
  ) {
    super("stack8:kubernetes:aws", name, undefined, opts)

    this.opts = { ...opts, parent: this }

    const clusterName = args.aws.cluster.cluster.name
    this.coreDns = new KubernetesAWSCoreDns(
      "core-dns",
      { clusterName },
      this.opts,
    )
    this.amazonCloudwatchObservability =
      new KubernetesAWSAmazonCloudwatchObservability(
        "amazon-cloudwatch-observability",
        { clusterName },
        this.opts,
      )
    this.amazonEBSCSIDriver = new KubernetesAWSAmazonEBSCSIDriver(
      "amazon-ebs-csi-driver",
      { clusterName },
      this.opts,
    )
    this.eksPodIdentityAgent = new KubernetesAWSEKSPodIdentityAgent(
      "eks-pod-identity-agent",
      { clusterName },
      this.opts,
    )
    this.awsLoadBalancerController = new KubernetesAWSLoadBalancerController(
      "aws-load-balancer-controller",
      args,
      this.opts,
    )
  }
}
