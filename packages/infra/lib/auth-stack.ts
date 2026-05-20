import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  /** Cognito User Pool ID — consumed by ApiStack and WebStack */
  readonly userPoolId: string;
  readonly userPoolArn: string;
  /** App Client ID — passed to the SPA as a public identifier */
  readonly userPoolClientId: string;
  /** JWKS issuer URL — used by Lambda JWT verification and ApiStack env vars */
  readonly userPoolIssuer: string;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // ── User Pool ──────────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'bookshelf-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // never accidentally delete user accounts
    });

    // ── App Client (SPA — public, no client secret) ────────────────────────
    const appClient = userPool.addClient('SpaClient', {
      userPoolClientName: 'bookshelf-spa',
      generateSecret: false, // PKCE flow — the SPA cannot keep a secret safe in the browser
      authFlows: {
        userSrp: true,        // standard SRP auth for the Amplify Auth SDK
        userPassword: false,  // disabled — prefer SRP
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ── SSM Parameters (read by CDK outputs + CI deploy scripts) ──────────
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: '/bookshelf/cognito/user-pool-id',
      stringValue: userPool.userPoolId,
      description: 'Bookshelf Cognito User Pool ID',
    });
    new ssm.StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: '/bookshelf/cognito/client-id',
      stringValue: appClient.userPoolClientId,
      description: 'Bookshelf Cognito SPA App Client ID',
    });

    // ── CloudFormation outputs ─────────────────────────────────────────────
    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    this.userPoolId = userPool.userPoolId;
    this.userPoolArn = userPool.userPoolArn;
    this.userPoolClientId = appClient.userPoolClientId;
    this.userPoolIssuer = issuer;

    new cdk.CfnOutput(this, 'UserPoolIdOutput', {
      exportName: 'BookshelfUserPoolId',
      value: userPool.userPoolId,
    });
    new cdk.CfnOutput(this, 'UserPoolClientIdOutput', {
      exportName: 'BookshelfUserPoolClientId',
      value: appClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, 'UserPoolIssuerOutput', {
      exportName: 'BookshelfUserPoolIssuer',
      value: issuer,
      description: 'JWKS issuer URL — used by Lambda JWT verification',
    });
  }
}
