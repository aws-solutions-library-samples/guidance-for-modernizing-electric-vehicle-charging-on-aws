#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import 'source-map-support/register';

import { AwsOcppGatewayStack } from '../lib/aws-ocpp-gateway-stack';

const app = new cdk.App();
new AwsOcppGatewayStack(app, 'AwsOcppGatewayStack', {
  env: {
    account: process.env.CDK_DEPLOY_ACCOUNT,
    region: process.env.CDK_DEPLOY_REGION,
  },

  // The default chip architecture used for ECS is ARM
  // You can override it to use X86_64 by uncommenting the following line
  // architecture: 'X86_64',

  // If you have a hosted zone in Route53, you can uncomment the following line
  // and replace "yourdomain.com" with your domain name
  // and the stack will create a subdomain "gateway.yourdomain.com" for you
  // and create a certificate for it.
  // This will enable TLS for your gateway. (wss://gateway.yourdomain.com)

  // domainName: 'yourdomain.com',
});
