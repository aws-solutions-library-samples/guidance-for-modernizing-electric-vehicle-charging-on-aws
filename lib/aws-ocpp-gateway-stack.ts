import * as actions from '@aws-cdk/aws-iot-actions-alpha';
import * as iot_core from '@aws-cdk/aws-iot-alpha';
import * as cdk from 'aws-cdk-lib';
import { aws_secretsmanager, aws_iot as iot } from 'aws-cdk-lib';
import { UlimitName } from "aws-cdk-lib/aws-ecs";
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaes from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import path from 'path';
import fetch from 'sync-fetch';

interface AwsOcppGatewayStackProps extends cdk.StackProps {
  domainName?: string;
  architecture?: string;
}

export class AwsOcppGatewayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: AwsOcppGatewayStackProps) {
    super(scope, id, props);

    const vpcCidr = '10.0.0.0/16';
    const tcpPort = 80;
    const tlsPort = 443;
    const mqttPort = 8883;
    const ocppSupportedProtocols = ['ocpp1.6', 'ocpp2.0', 'ocpp2.0.1'];

    const architecture = props?.architecture || 'arm64';
    const cpuArchitecture = architecture == 'arm64' ? ecs.CpuArchitecture.ARM64: ecs.CpuArchitecture.X86_64;
    const platform = architecture == 'arm64' ? ecr_assets.Platform.LINUX_ARM64 : ecr_assets.Platform.LINUX_AMD64;

    const defaultLambdaProps = {
      runtime: lambda.Runtime.PYTHON_3_9,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_DAY,
      architecture: lambda.Architecture.ARM_64,
    };

    const vpc = new ec2.Vpc(this, 'VPC', {
      ipAddresses: ec2.IpAddresses.cidr(vpcCidr),
      natGateways: 1,

      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Get the IoT endpoint
    const iotDescribeEndpointCr = new cr.AwsCustomResource(this, 'IOTDescribeEndpoint', {
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
          actions: ['iot:DescribeEndpoint'],
        }),
      ]),
      logRetention: logs.RetentionDays.ONE_DAY,
      onUpdate: {
        service: 'Iot',
        action: 'describeEndpoint',
        parameters: {
          endpointType: 'iot:Data-ATS',
        },
        physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()),
      },
    });
    const iotEndpoint = iotDescribeEndpointCr.getResponseField('endpointAddress');

    // create dynamodb table with encryption at rest for charge points list
    const chargePointTable = new dynamodb.Table(this, 'ChargePointTable', {
      partitionKey: {
        name: 'chargePointId',
        type: dynamodb.AttributeType.STRING,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Enable events for AWS IoT
    // https://docs.aws.amazon.com/iot/latest/developerguide/iot-events.html#iot-events-enable
    new cr.AwsCustomResource(this, 'UpdateEventConfigurations', {
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
          actions: ['iot:UpdateEventConfigurations'],
        }),
      ]),
      logRetention: logs.RetentionDays.ONE_DAY,
      onCreate: {
        service: 'Iot',
        action: 'updateEventConfigurations',
        parameters: {
          eventConfigurations: {
            THING: {
              Enabled: true,
            },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()),
      },
      onDelete: {
        service: 'Iot',
        action: 'updateEventConfigurations',
        parameters: {
          eventConfigurations: {
            THING: {
              Enabled: false,
            },
          },
        },
      },
    });

    new iot_core.TopicRule(this, 'CreateThingRule', {
      description: 'Insert new IOT Thing reference into DynamoDB',
      sql: iot_core.IotSql.fromStringAsVer20160323(
        "SELECT thingName as chargePointId, timestamp FROM '$aws/events/thing/+/created'",
      ),
      actions: [new actions.DynamoDBv2PutItemAction(chargePointTable)],
    });

    const deadLetterQueueForDeletedThings = new sqs.Queue(this, 'DeadLetterQueueForDeletedThings', {
      enforceSSL: true,
    });
    const deletedThings = new sqs.Queue(this, 'DeletedThings', {
      enforceSSL: true,
      deadLetterQueue: {
        queue: deadLetterQueueForDeletedThings,
        maxReceiveCount: 3,
      },
    });

    const deleteThing = new lambda.Function(this, 'DeleteThing', {
      ...defaultLambdaProps,
      handler: 'delete_thing.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/iot-rule-delete-thing')),
      environment: {
        DYNAMODB_CHARGE_POINT_TABLE: chargePointTable.tableName,
      },
    });
    chargePointTable.grantWriteData(deleteThing);

    const deleteThingEvent = new lambdaes.SqsEventSource(deletedThings);
    deleteThing.addEventSource(deleteThingEvent);

    new iot_core.TopicRule(this, 'DeleteThingRule', {
      description: 'Delete an IOT Thing reference from DynamoDB',
      sql: iot_core.IotSql.fromStringAsVer20160323(
        "SELECT thingName as chargePointId, timestamp FROM '$aws/events/thing/+/deleted'",
      ),
      actions: [new actions.SqsQueueAction(deletedThings)],
    });

    const iotGatewayPolicy = new iot.CfnPolicy(this, 'Policy', {
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: iam.Effect.ALLOW,
            Action: ['iot:Connect'],
            Resource: [`arn:aws:iot:${this.region}:${this.account}:client/*`],
          },
          {
            Effect: iam.Effect.ALLOW,
            Action: ['iot:Publish', 'iot:Receive'],
            Resource: [
              `arn:aws:iot:${this.region}:${this.account}:topic/*/in`,
              `arn:aws:iot:${this.region}:${this.account}:topic/*/out`,
            ],
          },
          {
            Effect: iam.Effect.ALLOW,
            Action: ['iot:Subscribe'],
            Resource: [
              `arn:aws:iot:${this.region}:${this.account}:topicfilter/*/in`,
              `arn:aws:iot:${this.region}:${this.account}:topicfilter/*/out`,
            ],
          },
        ],
      },
    });

    const iotCreateKeysAndCertificateCr = new cr.AwsCustomResource(this, 'KeysCerts', {
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
          actions: ['iot:CreateKeysAndCertificate', 'iot:UpdateCertificate'],
        }),
      ]),
      logRetention: logs.RetentionDays.ONE_DAY,
      onCreate: {
        service: 'Iot',
        action: 'createKeysAndCertificate',
        parameters: {
          setAsActive: true,
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('certificateId'),
      },
      onDelete: {
        service: 'Iot',
        action: 'updateCertificate',
        parameters: {
          certificateId: new cr.PhysicalResourceIdReference(),
          newStatus: 'INACTIVE',
        },
      },
    });

    const iotCertificatePem = iotCreateKeysAndCertificateCr.getResponseField('certificatePem');
    const iotCertificateArn = iotCreateKeysAndCertificateCr.getResponseField('certificateArn');
    const iotPublicKey = iotCreateKeysAndCertificateCr.getResponseField('keyPair.PublicKey');
    const iotPrivateKey = iotCreateKeysAndCertificateCr.getResponseField('keyPair.PrivateKey');

    new cr.AwsCustomResource(this, 'AttachPolicyIOT', {
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
          actions: ['iot:AttachPolicy', 'iot:DetachPolicy'],
        }),
      ]),
      logRetention: logs.RetentionDays.ONE_DAY,
      onCreate: {
        service: 'Iot',
        action: 'attachPolicy',
        parameters: {
          policyName: iotGatewayPolicy.attrId,
          target: iotCertificateArn,
        },
        physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()),
      },
      onDelete: {
        service: 'Iot',
        action: 'detachPolicy',
        parameters: {
          policyName: iotGatewayPolicy.attrId,
          target: iotCertificateArn,
        },
      },
    });

    const amazonRootCA = fetch('https://www.amazontrust.com/repository/AmazonRootCA1.pem').text();

    const amazonRootCAStorage = new aws_secretsmanager.Secret(this, 'IOTAmazonRootCAStorage', {
      secretStringValue: cdk.SecretValue.unsafePlainText(amazonRootCA),
      description: 'Store the IOT PEM file for amazon root certificate',
    });

    const iotPemCertificateStorage = new aws_secretsmanager.Secret(this, 'IOTPemCertificate', {
      secretStringValue: cdk.SecretValue.unsafePlainText(iotCertificatePem),
      description: 'Store the IOT PEM certificate associated with the Gateway',
    });

    const iotPublicKeyStorage = new aws_secretsmanager.Secret(this, 'IOTPublicCertificate', {
      secretStringValue: cdk.SecretValue.unsafePlainText(iotPublicKey),
      description: 'Store the IOT Public Key associated with the Gateway',
    });

    const iotPrivateKeyStorage = new aws_secretsmanager.Secret(this, 'IOTPrivateCertificate', {
      secretStringValue: cdk.SecretValue.unsafePlainText(iotPrivateKey),
      description: 'Store the IOT PEM certificate associated with the Gateway',
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsights: true,
      executeCommandConfiguration: {
        logging: ecs.ExecuteCommandLogging.DEFAULT,
      },
    });

    const gatewayRole = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    chargePointTable.grantReadData(gatewayRole);
    amazonRootCAStorage.grantRead(gatewayRole);
    iotPrivateKeyStorage.grantRead(gatewayRole);
    iotPublicKeyStorage.grantRead(gatewayRole);
    iotPemCertificateStorage.grantRead(gatewayRole);

    const gatewayExecutionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    });

    const ocppGatewayLogGroup = new logs.LogGroup(this, 'LogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.THREE_DAYS,
    });
    ocppGatewayLogGroup.grantWrite(gatewayRole);

    // create a task definition with CloudWatch Logs
    const ocppGatewayLogging = new ecs.AwsLogDriver({
      streamPrefix: 'Gateway',
      logGroup: ocppGatewayLogGroup,
    });

    const gatewayTaskDefinition = new ecs.FargateTaskDefinition(this, 'Task', {
      memoryLimitMiB: 1024,
      cpu: 512,
      taskRole: gatewayRole,
      executionRole: gatewayExecutionRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: cpuArchitecture,
      },
    });

    gatewayTaskDefinition.addVolume({
      name: 'iot-certificate-volume',
    });

    const gatewayContainerImage = new ecs.AssetImage(path.join(__dirname, '../src/ocpp-gateway-container'), {
      platform: platform,
    });

    const container = gatewayTaskDefinition.addContainer('Container', {
      image: gatewayContainerImage,
      logging: ocppGatewayLogging,
      environment: {
        AWS_REGION: cdk.Stack.of(this).region,
        DYNAMODB_CHARGE_POINT_TABLE: chargePointTable.tableName,
        IOT_ENDPOINT: iotEndpoint,
        IOT_PORT: `${mqttPort}`,
        OCPP_PROTOCOLS: ocppSupportedProtocols.join(','),
        OCPP_GATEWAY_PORT: `${tcpPort}`,
      },
      secrets: {
        IOT_AMAZON_ROOT_CA: ecs.Secret.fromSecretsManager(amazonRootCAStorage),
        IOT_GATEWAY_CERTIFICATE: ecs.Secret.fromSecretsManager(iotPemCertificateStorage),
        IOT_GATEWAY_PUBLIC_KEY: ecs.Secret.fromSecretsManager(iotPublicKeyStorage),
        IOT_GATEWAY_PRIVATE_KEY: ecs.Secret.fromSecretsManager(iotPrivateKeyStorage),
      },
    });

    container.addUlimits({
      name: UlimitName.NOFILE,
      softLimit:65536,
      hardLimit:65536
    });

    container.addPortMappings({
      containerPort: tcpPort,
      hostPort: tcpPort,
      protocol: ecs.Protocol.TCP,
    });

    container.addMountPoints({
      containerPath: '/etc/iot-certificates/',
      sourceVolume: 'iot-certificate-volume',
      readOnly: false,
    });

    const gatewaySecurityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });

    gatewaySecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpcCidr),
      ec2.Port.tcp(tcpPort),
      'Allow TCP traffic from within VPC',
    );

    const gatewayService = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: gatewayTaskDefinition,
      securityGroups: [gatewaySecurityGroup],
      desiredCount: 1,
      minHealthyPercent: 0,
    });

    const gatewayAutoScaling = gatewayService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 20,
    });

    gatewayAutoScaling.scaleOnCpuUtilization('AutoscalingProps', {
      targetUtilizationPercent: 60,
      scaleOutCooldown: cdk.Duration.seconds(30),
      scaleInCooldown: cdk.Duration.seconds(30),
    });

    const loadBalancer = new elbv2.NetworkLoadBalancer(this, 'LoadBalancer', {
      loadBalancerName: 'ocpp-gateway',
      vpc: vpc,
      internetFacing: true,
    });

    // If a domain name has been provided and its hosted zone id is hosted in route53,
    // the stack automatically creates a certificate and associate it with the load balancer
    // and creates a DNS record for the gateway to enable TLS (wss://)
    if (props?.domainName) {
      const recordName = 'gateway';

      const zone = route53.HostedZone.fromLookup(this, 'HostedZone', {
        domainName: props.domainName,
      });

      const gatewayDNSRecord = new route53.ARecord(this, 'DNSRecord', {
        zone,
        recordName,
        target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(loadBalancer)),
        deleteExisting: true,
      });
      gatewayDNSRecord.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

      const certificate = new acm.Certificate(this, 'Certificate', {
        domainName: `${recordName}.${props.domainName}`,
        validation: acm.CertificateValidation.fromDns(zone),
      });
      certificate.node.addDependency(gatewayDNSRecord);

      const tls = loadBalancer.addListener('TLSListener', {
        port: tlsPort,
        protocol: elbv2.Protocol.TLS,
        certificates: [certificate],
      });

      tls.addTargets('tls', {
        port: tcpPort,
        protocol: elbv2.Protocol.TCP,
        targets: [gatewayService],
        deregistrationDelay: cdk.Duration.seconds(10),
        healthCheck: {
          healthyThresholdCount: 2,
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(5),
        },
      });
    } else {
      // otherwise if a domain name has not been provided, the stack creates a listener
      // on the load balancer to accept TCP connections on port 80.
      // this is to enable testing the solutoin withut having to buy and configure a domain name
      // This is not recommended for production use.
      const http = loadBalancer.addListener('TCPListener', {
        port: tcpPort,
        protocol: elbv2.Protocol.TCP,
      });

      http.addTargets('tcp', {
        port: tcpPort,
        protocol: elbv2.Protocol.TCP,
        targets: [gatewayService],
        deregistrationDelay: cdk.Duration.seconds(10),
        healthCheck: {
          healthyThresholdCount: 2,
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(5),
        },
      });
    }

    const deadLetterQueueForIncomingMessages = new sqs.Queue(this, 'DeadLetterQueueForIncomingMessages', {
      enforceSSL: true,
    });
    const incomingMessages = new sqs.Queue(this, 'IncomingMessagesQueue', {
      enforceSSL: true,
      deadLetterQueue: {
        queue: deadLetterQueueForIncomingMessages,
        maxReceiveCount: 3,
      },
    });

    new iot_core.TopicRule(this, 'MessagesFromChargePointsRule', {
      description:
        'Insert messages coming from Charge Points into an SQS queue to be processed by the message processor',
      sql: iot_core.IotSql.fromStringAsVer20160323("SELECT * as message,topic(1) as chargePointId FROM '+/in'"),
      actions: [new actions.SqsQueueAction(incomingMessages)],
    });

    const messageProcessor = new lambda.Function(this, 'OCPPMessageProcessor', {
      ...defaultLambdaProps,
      handler: 'message_processor.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/ocpp-message-processor'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_9.bundlingImage,
          command: ['bash', '-c', 'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output'],
        },
      }),
    });

    messageProcessor.role?.attachInlinePolicy(
      new iam.Policy(this, 'PublishToOutTopicPolicy', {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [
              `arn:aws:iot:${this.region}:${this.account}:topic/$aws/things/*/shadow/update`,
              `arn:aws:iot:${this.region}:${this.account}:topic/*/out`,
            ],
            actions: ['iot:Publish'],
          }),
        ],
      }),
    );

    const incomingMessageEvent = new lambdaes.SqsEventSource(incomingMessages);
    messageProcessor.addEventSource(incomingMessageEvent);

    // OUTPUTS
    if (props?.domainName) {
      new cdk.CfnOutput(this, 'loadBalancerDnsName', {
        value: `gateway.${props.domainName}`,
        description: 'The Gateway domain name',
        exportName: 'loadBalancerDnsName',
      });
      new cdk.CfnOutput(this, 'websocketURL', {
        value: `wss://gateway.${props.domainName}`,
        description: 'The Gateway websocket URL',
        exportName: 'websocketURL',
      });
    } else {
      new cdk.CfnOutput(this, 'loadBalancerDnsName', {
        value: loadBalancer.loadBalancerDnsName,
        description: 'The Gateway NLB DNS name',
        exportName: 'loadBalancerDnsName',
      });
      new cdk.CfnOutput(this, 'websocketURL', {
        value: `ws://${loadBalancer.loadBalancerDnsName}`,
        description: 'The Gateway websocket URL',
        exportName: 'websocketURL',
      });
    }
  }
}
