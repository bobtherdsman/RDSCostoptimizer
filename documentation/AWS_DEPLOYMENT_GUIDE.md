# AWS Deployment Guide

## Purpose

This guide describes how to deploy the standalone RDS SQL Server Cost Optimization application to AWS in a way that another engineer, automation tool, or deployment agent can follow without changing the product scope.

The application is a Node.js/Express backend that serves:

- the business website and assessment pages
- the collector ZIP download
- manual collector ZIP upload
- workload analysis
- JSON, CSV, and PDF-style exports

The deployment must preserve the approved product flow:

```text
Download collector
  -> run collector against RDS SQL Server
  -> upload collector ZIP
  -> analyze workload optimization
  -> view/export recommendation evidence
```

## Mandatory Product Boundaries

Do not add these during deployment:

- detailed pricing calculations
- storage-provisioning recommendations
- automated RDS changes
- SSATWeb sizing logic or SSATWeb dependencies
- manual JSON side inputs for optimization
- application data inspection
- SQL text, query plans, Query Store data, traces, table row scans, uploaded credentials, or PII collection

The deployment is hosting only. It must not change collector, parser, optimizer, harness, report, or recommendation behavior.

## Current Application Shape

Runtime:

- Node.js 20 or later
- Express backend
- Server entrypoint: `dist/server/index.js`
- Build command: `npm run build:app`
- Local server command: `npm run server`
- Health check: `GET /healthz`
- Main page: `GET /cost`
- Collector download: `GET /cost/collector`
- Assessment upload: `POST /cost/analyze`

Important files:

- `package.json`
- `package-lock.json`
- `tsconfig.app.json`
- `src/server/index.ts`
- `src/ui/html.ts`
- `src/catalog/data/rds-sqlserver-orderable.json`
- `collector/costoptimization/*`

The runtime catalog loader can read the catalog from `src/catalog/data` or `dist/catalog/data`. A deployment package must include `src/catalog/data/rds-sqlserver-orderable.json` unless the build process is changed to copy catalog JSON into `dist/catalog/data`.

## Required Environment Variables

Set these in the AWS runtime environment:

```text
COST_OWNER_EMAIL=<approved owner email>
AWS_REGION=us-east-1
PORT=<platform-provided port or 3001>
NODE_ENV=production
```

Notes:

- `COST_OWNER_EMAIL` controls owner-only manual upload access.
- `AWS_REGION` is the fallback Region for orderability lookup when the uploaded RDS endpoint cannot be parsed.
- `PORT` should be supplied by the platform when available. If omitted, the app defaults to `3001`.

## Recommended Deployment Choices

### Option A - Cheapest First Production: Lightsail

Use Lightsail when the goal is the lowest-cost always-on backend with simple operations.

Best for:

- first customer demo
- internal pilot
- low traffic
- keeping monthly cost predictable
- avoiding container/platform complexity

Tradeoffs:

- you manage OS patching
- you manage Nginx and TLS renewal
- scaling is manual
- no built-in blue/green deployment

### Option B - Best Managed Simple Backend: AWS App Runner

Use App Runner when you want AWS to manage the HTTPS endpoint, service runtime, deployment, and scaling.

Best for:

- managed production service
- GitHub or container-image deployment
- less server maintenance
- easier future move to S3/DynamoDB-backed workflows

Tradeoffs:

- usually costs more than a tiny Lightsail instance for an always-on low-traffic app
- source deploy must build correctly in App Runner
- large synchronous uploads should be watched carefully

### Option C - Managed EC2 App Platform: Elastic Beanstalk

Use Elastic Beanstalk single-instance mode when you want an EC2-based deployment managed by AWS without running the raw VM setup yourself.

Best for:

- teams familiar with Beanstalk
- single-instance Node.js deployment
- easier CloudWatch and environment management than raw EC2

Tradeoffs:

- more moving pieces than Lightsail
- can become more expensive if a load balancer is added
- still less modern than App Runner for simple web services

## Recommended Path

Start with one of these:

1. Cheapest: Lightsail Ubuntu instance with Nginx, PM2, and HTTPS.
2. Managed: App Runner from GitHub source or ECR container image.

For this project, App Runner is the cleaner managed backend. Lightsail is the cheapest practical backend.

## Pre-Deployment Checklist

Run these locally before deployment:

```powershell
npm ci
npm run build
powershell -ExecutionPolicy Bypass -File tests/run-typescript-tests.ps1
```

Optional full validation:

```powershell
npm run test
```

Expected result:

- TypeScript build passes.
- Unit/regression tests pass.
- No credentials appear in generated report output.
- `src/catalog/data/rds-sqlserver-orderable.json` exists.
- `collector/costoptimization` contains the collector scripts.

Do not deploy from a dirty working tree unless the deployment tool is intentionally deploying a specific committed revision.

## App Runner Deployment

### App Runner Source Deployment

Use this when connecting App Runner directly to GitHub.

Repository:

```text
https://github.com/bobtherdsman/RDSCostoptimizer.git
```

Branch:

```text
main
```

Runtime:

```text
Node.js 20 or later
```

Build command:

```bash
npm ci && npm run build:app
```

Start command:

```bash
node dist/server/index.js
```

Port:

```text
Use the platform PORT environment variable.
```

Health check:

```text
Path: /healthz
Protocol: HTTP
```

Environment variables:

```text
COST_OWNER_EMAIL=<approved owner email>
AWS_REGION=us-east-1
NODE_ENV=production
```

Deployment steps:

1. Open AWS App Runner.
2. Create service.
3. Select source code repository.
4. Connect GitHub if not already connected.
5. Select repository `bobtherdsman/RDSCostoptimizer`.
6. Select branch `main`.
7. Configure runtime as Node.js 20 or later.
8. Set build command to `npm ci && npm run build:app`.
9. Set start command to `node dist/server/index.js`.
10. Set health check path to `/healthz`.
11. Add the environment variables.
12. Use the smallest CPU/memory configuration that supports ZIP upload and analysis.
13. Deploy.
14. Open the App Runner URL and verify `/cost`.

Validation after App Runner deployment:

```bash
curl -i https://<app-runner-service-url>/healthz
curl -I https://<app-runner-service-url>/cost
curl -I https://<app-runner-service-url>/cost/collector
```

Expected:

- `/healthz` returns `200`.
- `/cost` returns HTML.
- `/cost/collector` returns a ZIP download response.

### App Runner Container Deployment

Use this when a deployment tool prefers Docker/ECR.

Create a `Dockerfile` only if the deployment tool requires it. Suggested content:

```dockerfile
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json ./
COPY src ./src
COPY collector ./collector

RUN npm run build:app

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/server/index.js"]
```

Important:

- Do not omit `src/catalog/data`.
- Do not omit `collector/costoptimization`.
- Do not copy `.env`.
- Do not copy `node_modules` from the local machine.
- Do not copy `tobedeleted`.

Container build:

```bash
docker build -t rds-cost-optimization:latest .
```

Push to ECR:

```bash
aws ecr create-repository --repository-name rds-cost-optimization
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
docker tag rds-cost-optimization:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/rds-cost-optimization:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/rds-cost-optimization:latest
```

Then create App Runner service from the ECR image.

## Lightsail Deployment

Use Ubuntu LTS unless your organization has a different standard.

### 1. Create the Instance

Minimum suggested shape for a low-traffic pilot:

```text
Lightsail Linux/Unix
Ubuntu LTS
Smallest instance that has enough memory for Node, TypeScript build, catalog JSON, ZIP parsing, and uploads
```

Security:

- Allow inbound TCP `22` only from trusted admin IPs.
- Allow inbound TCP `80`.
- Allow inbound TCP `443`.
- Do not expose port `3001` publicly.

### 2. Install Runtime Packages

SSH into the instance:

```bash
sudo apt-get update
sudo apt-get install -y git nginx unzip curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

### 3. Deploy the Code

```bash
sudo mkdir -p /opt/rds-cost-optimization
sudo chown -R $USER:$USER /opt/rds-cost-optimization
cd /opt/rds-cost-optimization
git clone https://github.com/bobtherdsman/RDSCostoptimizer.git app
cd app
npm ci
npm run build:app
```

Create environment file:

```bash
cat > .env.production <<'EOF'
COST_OWNER_EMAIL=<approved owner email>
AWS_REGION=us-east-1
PORT=3001
NODE_ENV=production
EOF
chmod 600 .env.production
```

### 4. Start the Backend With PM2

```bash
cd /opt/rds-cost-optimization/app
pm2 start dist/server/index.js --name rds-cost-optimization --time --update-env -- env $(cat .env.production | xargs)
pm2 save
pm2 startup
```

Follow the command printed by `pm2 startup` to register the service at boot.

Validate locally on the instance:

```bash
curl -i http://127.0.0.1:3001/healthz
curl -I http://127.0.0.1:3001/cost
```

### 5. Configure Nginx

Create:

```bash
sudo nano /etc/nginx/sites-available/rds-cost-optimization
```

Nginx config:

```nginx
server {
    listen 80;
    server_name <your-domain-name>;

    client_max_body_size 120m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/rds-cost-optimization /etc/nginx/sites-enabled/rds-cost-optimization
sudo nginx -t
sudo systemctl reload nginx
```

Validate:

```bash
curl -i http://<your-domain-name>/healthz
curl -I http://<your-domain-name>/cost
```

### 6. Add HTTPS

Install Certbot:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <your-domain-name>
```

Validate:

```bash
curl -i https://<your-domain-name>/healthz
curl -I https://<your-domain-name>/cost/collector
```

### 7. Updating Lightsail

```bash
cd /opt/rds-cost-optimization/app
git pull origin main
npm ci
npm run build:app
pm2 restart rds-cost-optimization --update-env
```

Rollback:

```bash
cd /opt/rds-cost-optimization/app
git log --oneline -5
git checkout <previous-good-commit>
npm ci
npm run build:app
pm2 restart rds-cost-optimization --update-env
```

## Elastic Beanstalk Deployment

Use this if the deployment tool already supports Beanstalk.

Recommended environment:

```text
Platform: Node.js
Type: Single instance
Load balancer: disabled for cheapest setup
Health check path: /healthz
Environment variables:
  COST_OWNER_EMAIL=<approved owner email>
  AWS_REGION=us-east-1
  NODE_ENV=production
```

Because this project uses TypeScript, Beanstalk must run a build before start. The deployment package should include source files, `package.json`, `package-lock.json`, and `tsconfig.app.json`.

Add a `Procfile` only if the deployment tool requires one:

```text
web: npm run build:app && node dist/server/index.js
```

For faster start, build during deployment and use:

```text
web: node dist/server/index.js
```

If using a prebuilt artifact, make sure the artifact contains:

- `dist`
- `src/catalog/data`
- `collector/costoptimization`
- `package.json`
- `package-lock.json`
- production `node_modules` or install step

## Future Production Backend Additions

The current app can run without a database because uploads are processed in memory and results are returned immediately.

Add these only when the business needs them:

### S3 Upload and Report Storage

Use S3 when:

- collector ZIPs must be retained
- reports must be downloadable later
- uploads exceed comfortable synchronous request handling
- multiple users need audit history

Suggested buckets:

```text
rds-cost-optimization-uploads-<env>
rds-cost-optimization-reports-<env>
```

Security:

- block public access
- encrypt with SSE-S3 or KMS
- lifecycle-delete raw collector ZIPs after the approved retention period
- never store SQL credentials

### DynamoDB Job and Result Index

Use DynamoDB when:

- assessments need status tracking
- long-running analysis should move to background jobs
- users need history

Suggested table:

```text
RdsCostOptimizationAssessments
```

Suggested keys:

```text
PK: ownerEmail
SK: assessmentId
```

Suggested attributes:

- status
- createdAt
- updatedAt
- sourceUploadKey
- reportJsonKey
- reportCsvKey
- reportPdfKey
- serverCount
- recommendedCount
- aggressiveCount
- notRecommendedCount

### Background Worker

Use SQS plus a worker service when:

- analysis takes too long for synchronous web requests
- uploads become large
- several customers submit at once

Flow:

```text
Browser uploads ZIP to S3
  -> API creates job row
  -> API sends SQS message
  -> worker analyzes S3 object
  -> worker writes reports to S3
  -> worker updates DynamoDB status
  -> browser polls job status
```

This is a later architecture. Do not add it to the first cheap deployment unless required.

## IAM Guidance

For the current no-S3/no-DynamoDB deployment:

- the app does not need AWS data-plane permissions at runtime
- the platform role only needs permissions required by the AWS hosting service itself

For future S3/DynamoDB deployment:

Grant least privilege:

- `s3:GetObject`, `s3:PutObject`, and lifecycle-managed access only to the deployment buckets
- `dynamodb:GetItem`, `PutItem`, `UpdateItem`, and `Query` only on the assessment table
- CloudWatch Logs write permissions
- no RDS modification permissions

Do not grant:

- `rds:ModifyDBInstance`
- broad administrator access
- access to unrelated buckets
- permissions to customer databases

## Security Baseline

Required:

- HTTPS only for public access
- owner-only upload enforcement with `COST_OWNER_EMAIL`
- platform or reverse-proxy max body size set to at least `120 MB`
- no public access to raw collector uploads
- no `.env` committed to git
- CloudWatch or host logs enabled
- regular dependency updates
- test run before every production deployment

Recommended before external customers:

- replace email text-box access with real authentication
- add audit logging
- add malware scanning for uploaded ZIPs
- add rate limiting
- add WAF or CloudFront in front of the service
- add S3 retention policy if uploads are stored
- add alarms for 5xx, high memory, failed health checks, and disk usage

## Smoke Test Plan

Run after every deploy:

```bash
curl -i https://<host>/healthz
curl -I https://<host>/cost
curl -I https://<host>/cost/services
curl -I https://<host>/cost/assessment
curl -I https://<host>/cost/collector
```

Expected:

- `/healthz` returns `200`.
- `/cost`, `/cost/services`, and `/cost/assessment` return HTML.
- `/cost/collector` returns `Content-Type: application/zip` or equivalent binary download response.

Manual browser smoke:

1. Open `/cost`.
2. Open the Solutions dropdown.
3. Open Offering Services.
4. Download the collector.
5. Open Start Assessment.
6. Upload a known-safe regression package in a non-production environment.
7. Confirm the result page renders a recommendation, confidence, blockers, and export links.

## Deployment Decision Matrix

| Requirement | Lightsail | App Runner | Elastic Beanstalk |
| --- | --- | --- | --- |
| Cheapest always-on pilot | Best | Good, but usually more than Lightsail | Good if single instance |
| Managed HTTPS endpoint | Manual with Nginx/Certbot | Built in | Managed with config |
| GitHub source deployment | Manual git pull | Built in | Supported with pipeline/tooling |
| Server maintenance | You manage | AWS manages | AWS manages platform, still EC2-backed |
| Fastest simple setup | Good | Best | Good |
| Future S3/job architecture | Good | Best | Good |

## Recommended Initial Implementation

For the first public/internal release:

```text
Use App Runner if managed operations matter more than the lowest bill.
Use Lightsail if the lowest bill matters more than managed operations.
```

Do not build the S3/DynamoDB/job system for the first deployment unless upload size, result history, or compliance retention requires it.

## Official AWS References

- App Runner developer guide: `https://docs.aws.amazon.com/apprunner/latest/dg/what-is-apprunner.html`
- App Runner source deployment: `https://docs.aws.amazon.com/apprunner/latest/dg/service-source-code.html`
- App Runner pricing: `https://aws.amazon.com/apprunner/pricing/`
- Lightsail pricing: `https://aws.amazon.com/lightsail/pricing/`
- Elastic Beanstalk pricing: `https://aws.amazon.com/elasticbeanstalk/pricing/`
- Lambda quotas and request limits: `https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html`
