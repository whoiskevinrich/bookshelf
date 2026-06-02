#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/auth-stack";
import { ApiStack } from "../lib/api-stack";
import { WebStack } from "../lib/web-stack";

const app = new cdk.App();

// Build env object without explicit `undefined` values (required by exactOptionalPropertyTypes)
const account = process.env["CDK_DEFAULT_ACCOUNT"] ?? process.env["AWS_ACCOUNT_ID"];
const region = process.env["CDK_DEFAULT_REGION"] ?? process.env["AWS_REGION"] ?? "us-east-1";
const env: cdk.Environment = account ? { account, region } : { region };

// Version tag passed in from CI: cdk deploy -c version=v1.2.3
const version = (app.node.tryGetContext("version") as string | undefined) ?? "local";

// Self-signup is disabled by default (dev). Pass -c allowSelfSignUp=true for prod.
const allowSelfSignUp = app.node.tryGetContext("allowSelfSignUp") === "true";
const auth = new AuthStack(app, "BookshelfAuth", { env, allowSelfSignUp });

new ApiStack(app, "BookshelfApi", {
  env,
  userPoolId: auth.userPoolId,
  userPoolIssuer: auth.userPoolIssuer,
  userPoolClientId: auth.userPoolClientId,
});

const web = new WebStack(app, "BookshelfWeb", {
  env,
  version,
});

// WebStack has no CDK cross-stack references to Auth/Api, but it must deploy
// after them so that the web build (run in CI before cdk deploy BookshelfWeb)
// can bake the resolved API URL and Cognito IDs into the VITE_* bundle.
// Declaring the dependency here keeps `cdk deploy --all` safe even if someone
// runs it without the two-step CI split.
web.addDependency(auth);

cdk.Tags.of(app).add("Project", "bookshelf");
cdk.Tags.of(app).add("Version", version);
