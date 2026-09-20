# Guruji infrastructure (Terraform)

Enterprise-grade AWS backend for Guruji, as Terraform. Nothing here is deployed
yet — this is the full IaC, ready to `plan`/`apply` once you point it at an AWS
account. Runtime is deliberately lean (serverless, ~$0–5/mo for one user); the
"enterprise" is in the scaffolding: remote state, keyless CI via OIDC/WIF,
least-privilege IAM, observability, and dev/prod separation.

## Architecture

```
 PWA ──▶ CloudFront + S3 (private, OAC)            [modules/frontend]  (optional)
   │  JWT (Cognito)
   ▼
 API Gateway HTTP API ──▶ Cognito JWT authorizer   [modules/apigateway, cognito]
   │
   ▼
 Lambda (Node 20) ──▶ DynamoDB single-table        [modules/lambda, dynamodb]
   │                    (PK=USER#sub, GSI1, PITR, deletion protection)
   └─ CloudWatch logs/alarms + budget              [modules/observability]

 State:  S3 + DynamoDB lock                         [bootstrap]
 CI/CD:  GitHub Actions → AWS via OIDC/WIF          [.github/workflows/deploy-infra.yml]
```

## Layout

```
infra/
  bootstrap/            # remote state bucket + lock + GitHub OIDC role (run ONCE, local state)
  modules/
    app-stack/          # composes the leaf modules for one environment
    dynamodb/  cognito/  lambda/  apigateway/  frontend/  observability/
  envs/dev/  envs/prod/ # thin roots: provider + backend + one app-stack call
services/api/           # the Lambda source (placeholder handler for now)
```

## One-time bootstrap

Creates the state backend and the CI role. Uses **local** state.

```bash
cd infra/bootstrap
terraform init
terraform apply \
  -var 'state_bucket_name=guruji-tfstate-<your-unique-suffix>' \
  -var 'github_owner=andytambe31' -var 'github_repo=guruji'
terraform output   # note state_bucket, lock_table, ci_role_arn
```

Then set GitHub repo **Variables** (Settings → Secrets and variables → Actions):
`AWS_ROLE_ARN` = `ci_role_arn`, `TF_STATE_BUCKET` = `state_bucket`,
`TF_LOCK_TABLE` = `lock_table`.

## Deploy an environment (dev shown)

```bash
cd infra/envs/dev
cp backend.hcl.example backend.hcl           # fill in state_bucket
cp terraform.tfvars.example terraform.tfvars # adjust region/email/origins
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
terraform output   # api_endpoint, cognito ids, frontend_domain
```

Create your user (self-signup is off):

```bash
aws cognito-idp admin-create-user \
  --user-pool-id "$(terraform output -raw cognito_user_pool_id)" \
  --username you@example.com --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true
```

If `enable_frontend = true`, publish the PWA:

```bash
aws s3 sync ../../../ "s3://$(terraform output -raw frontend_bucket)" \
  --exclude '.git/*' --exclude 'infra/*' --exclude 'services/*' --exclude 'scratch-tests/*'
aws cloudfront create-invalidation \
  --distribution-id "$(terraform output -raw frontend_distribution_id)" --paths '/*'
```

## CI/CD

`.github/workflows/deploy-infra.yml`: on a PR touching `infra/**` it runs
`fmt`/`validate`/`plan` for dev+prod via the OIDC role (no stored keys); a manual
**workflow_dispatch** applies the chosen env. It won't run on ordinary pushes, so
nothing deploys until you wire the AWS account and trigger it.

## Notes / deliberate choices

- **Server-authoritative + Cognito**: the API is the source of truth; the browser
  keeps an IndexedDB read-through cache (client work, not in this repo yet).
- **DynamoDB single-table** (PK/SK + GSI1) mirrors the app's own DynamoDB guide.
- **`services/api/index.mjs` is a placeholder** — a `/health` route and a `/state`
  query prove the wiring; the real CRUD (`/items`, `/log`, `/settings`,
  `/pipeline` with `If-Match` optimistic concurrency) is the next milestone.
- **IAM**: the CI role uses `PowerUserAccess` + a scoped IAM grant for `guruji-*`
  roles — tighten for a shared account. Lambda's own role is least-privilege
  (logs + X-Ray + this table only).
- Run `terraform fmt -recursive` before your first commit to satisfy the (advisory)
  format check.
```
