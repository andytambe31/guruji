terraform {
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.40" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
  }
}

# The whole application stack for one environment, composed from the leaf
# modules. Each env root just calls this with env-specific inputs + backend.
locals {
  prefix = "${var.project}-${var.env}"
  tags = merge({
    Project     = var.project
    Environment = var.env
    ManagedBy   = "terraform"
  }, var.tags)
}

module "dynamodb" {
  source              = "../dynamodb"
  name                = "${local.prefix}-data"
  deletion_protection = var.deletion_protection
  tags                = local.tags
}

module "cognito" {
  source                  = "../cognito"
  name                    = "${local.prefix}-users"
  callback_urls           = var.app_origins
  logout_urls             = var.app_origins
  hosted_ui_domain_prefix = var.cognito_domain_prefix
  tags                    = local.tags
}

module "lambda" {
  source        = "../lambda"
  name          = "${local.prefix}-api"
  source_dir    = var.api_source_dir
  handler       = "index.handler"
  table_name    = module.dynamodb.table_name
  table_arn     = module.dynamodb.table_arn
  table_gsi_arn = module.dynamodb.gsi1_arn
  environment = {
    ENV               = var.env
    COGNITO_USER_POOL = module.cognito.user_pool_id
    COGNITO_CLIENT_ID = module.cognito.client_id
    COGNITO_ISSUER    = module.cognito.issuer

    # The strong single-user gate: only these principals get past authz, even
    # with a valid pool token. Fail closed when the list is empty.
    ALLOWED_SUBS      = join(",", var.allowed_subs)
    ALLOWED_EMAILS    = join(",", var.allowed_emails)
    REQUIRE_ALLOWLIST = tostring(var.require_allowlist)
    CORS_ORIGINS      = join(",", var.app_origins)
  }
  tags = local.tags
}

module "api" {
  source               = "../apigateway"
  name                 = "${local.prefix}-http"
  lambda_invoke_arn    = module.lambda.invoke_arn
  lambda_function_name = module.lambda.function_name
  cognito_issuer       = module.cognito.issuer
  cognito_client_id    = module.cognito.client_id
  cors_allow_origins   = length(var.app_origins) > 0 ? var.app_origins : ["*"]
  tags                 = local.tags
}

module "frontend" {
  count               = var.enable_frontend ? 1 : 0
  source              = "../frontend"
  bucket_name         = "${local.prefix}-web"
  domain_aliases      = var.frontend_domain_aliases
  acm_certificate_arn = var.frontend_acm_certificate_arn
  tags                = local.tags
}

module "observability" {
  source               = "../observability"
  name                 = local.prefix
  lambda_function_name = module.lambda.function_name
  api_id               = module.api.api_id
  table_name           = module.dynamodb.table_name
  alert_email          = var.alert_email
  budget_limit_usd     = var.budget_limit_usd
  tags                 = local.tags
}
