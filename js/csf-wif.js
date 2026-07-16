// CS Fundamentals · Security & Auth — "Workload Identity Federation (WIF)". A
// breadth-first fundamentals guide: the static-credential problem WIF solves, the
// OIDC/token-exchange trust flow, the GCP pool/provider/attribute-mapping model,
// the equivalent on AWS and Azure, and the gotchas. Rendered in the app's Markdown
// dialect; backticks are escaped (\`) because the whole guide is a template literal.
export const CSF_WIF_GUIDE = `# Workload Identity Federation (WIF)

A way to let a workload in **one** trust domain (a CI job, a pod, a VM, a lambda, an on-prem service) call APIs in **another** — **without a long-lived secret**. Instead of minting a service-account key and copying it around, the workload proves who it is with a **short-lived token its own platform already issues**, and the target cloud exchanges that token for temporary credentials. The whole point: **stop storing static keys.** Skim in ~15 minutes; the *Gotchas* are where real incidents come from.

## 1. The problem it solves

The classic way to let, say, a GitHub Actions job deploy to GCP is to create a **service-account key** (a JSON private key), paste it into a CI secret, and ship it. That key is:

- **Long-lived** — valid until someone manually rotates it (often never).
- **Copyable** — it's a bearer secret; anyone who reads it *is* the service account, anywhere.
- **Widely leaked** — CI logs, forked repos, laptops, \`.env\` files, Slack. Static cloud keys are one of the most common breach roots.

WIF removes the key entirely. There is nothing long-lived to leak, because the only credential in flight is a token that expires in minutes and is bound to a specific workload.

## 2. The core idea — federated trust + token exchange

Two ingredients:

1. **The workload already has an identity token.** Modern platforms issue their workloads a signed, short-lived **OIDC token** (a JWT) describing *what* is running: GitHub Actions gives each job an OIDC token with claims like \`repository\`, \`ref\`, \`workflow\`; a Kubernetes pod gets a projected service-account token; an AWS role has its own signed identity. The issuer publishes a public **JWKS** endpoint so anyone can verify the token's signature.

2. **The target cloud is told to trust that issuer** — but only under precise conditions — and to **exchange** a valid token for its own short-lived credentials.

\`\`\`
  workload (GitHub job / pod / VM)
        │  1. platform mints a signed OIDC token (JWT): "I am repo X, branch main"
        ▼
  target cloud's federation endpoint (STS)
        │  2. verify signature against issuer's JWKS
        │  3. check the token's claims against the configured conditions
        │  4. map claims → a principal, mint SHORT-LIVED credentials
        ▼
  temporary credentials (minutes) ──► call cloud APIs as the mapped identity
\`\`\`

No secret ever leaves the workload's platform; the workload only ever presents a token it was *given*, and the target only trusts it because it verified the signature **and** the claims.

## 3. GCP terminology — pool, provider, attribute mapping

Google's implementation is literally called **Workload Identity Federation**, and its objects are the clearest way to learn the model:

- **Workload Identity Pool** — a container for external identities. Federated principals live "inside" a pool, namespaced so they can't collide with anything else.
- **Workload Identity Pool Provider** — configures **one external issuer** (e.g. GitHub's OIDC issuer \`https://token.actions.githubusercontent.com\`). It holds the issuer URI, the allowed audience, and the two rule sets below.
- **Attribute mapping** — translates claims in the incoming token into Google attributes:
\`\`\`
  google.subject      = assertion.sub
  attribute.repository = assertion.repository
  attribute.ref        = assertion.ref
\`\`\`
- **Attribute condition** — a CEL expression that must be **true** or the exchange is rejected. This is the security boundary:
\`\`\`
  assertion.repository == 'my-org/my-repo' &&
  assertion.ref == 'refs/heads/main'
\`\`\`
- **Binding to a service account** — the mapped principal is granted \`roles/iam.workloadIdentityUser\` on a target service account, so the exchange yields that SA's short-lived token. (Direct resource access without an intermediate SA is also possible.)

So the trust chain reads: *this pool* trusts *this provider (issuer)*, and only tokens whose claims satisfy *this condition* may impersonate *this service account*.

## 4. The equivalent on AWS and Azure

The pattern is universal; only the nouns change.

| | GCP | AWS | Azure |
|---|---|---|---|
| Trust object | Workload Identity Pool **Provider** | IAM **OIDC identity provider** | App registration **federated credential** |
| What you assume | a service account (or resource) | an **IAM role** | a managed identity / app |
| Exchange API | STS \`token()\` | \`sts:AssumeRoleWithWebIdentity\` | Entra token endpoint |
| Condition mechanism | CEL **attribute condition** | the role's **trust policy** (\`Condition\` on \`sub\`/\`aud\`) | subject/issuer match on the fed credential |

- **AWS:** register the issuer as an **IAM OIDC provider**, then write an IAM role whose **trust policy** allows \`sts:AssumeRoleWithWebIdentity\` only when \`token.actions.githubusercontent.com:sub\` matches \`repo:my-org/my-repo:ref:refs/heads/main\`. The job gets temporary STS credentials.
- **Azure:** add a **federated identity credential** to an app registration / managed identity, matching on issuer + subject; the workload gets an Entra access token — no client secret.
- **GKE / EKS Workload Identity** is the same idea *inside* Kubernetes: a pod's service-account token is federated so the pod acts as a cloud identity without a node-wide key.

## 5. WIF in practice — connecting to Snowflake with no keys

The examples above federate a workload into *its own cloud*. But a SaaS product can be the **relying party** too: Snowflake accepts WIF, so an app, container, VM, or CI job connects to it using its cloud platform's native identity — no password, no static API key, no self-managed key-pair. In Snowflake this is the \`WORKLOAD_IDENTITY\` authenticator (surfaced as \`authenticator = "WORKLOAD_IDENTITY"\` in a connector, or \`snowflake_auth_mode = "workload_identity"\` in some tooling — same handshake either way).

**The passwordless flow**

\`\`\`
[ your app ] ──1. request token──► [ cloud IdP: AWS / GCP / Azure / GitHub ]
      │                                          │
      │                             2. short-lived JWT (proves the workload)
      ▼                                          ▼
[ Snowflake driver ] ──3. send JWT + connect──► [ Snowflake verifies + logs in as the service user ]
\`\`\`

1. **Request identity** — on connect, the Snowflake driver reaches out to the host's native metadata / identity service.
2. **Retrieve token** — the cloud IdP issues a short-lived JWT proving the workload's identity.
3. **Verify with Snowflake** — the driver sends the JWT; Snowflake validates it against its established cryptographic trust with that provider and logs you in as the mapped **service user**.

**Supported identity providers** — **AWS** (IAM roles via EKS / EC2 / Lambda), **GCP** (service accounts via GKE / Compute Engine), **Azure** (Managed Identities), and any **OIDC** provider such as **GitHub Actions** (passwordless CI/CD).

**Why reach for it** — no secret rotation (tokens live minutes, so there's nothing to encrypt, rotate, or leak), lower overhead (it reuses identity systems you already own — AWS IAM, Azure Entra ID), and secure-by-default zero-trust posture.

**Configure it — the two halves**

\`\`\`
-- 1) In Snowflake: a SERVICE user mapped to the cloud resource's identity (ARN / subject)
CREATE USER wif_service_user
  TYPE = SERVICE
  WORKLOAD_IDENTITY = ( TYPE = AWS
                        ARN = 'arn:aws:iam::123456789012:role/MyApplicationRole' )
  DEFAULT_ROLE = MY_APP_ROLE;
\`\`\`

\`\`\`
# 2) In the client: pick the WORKLOAD_IDENTITY authenticator + your provider
import snowflake.connector
conn = snowflake.connector.connect(
    account = 'your_account_identifier',
    user    = 'wif_service_user',
    authenticator = 'WORKLOAD_IDENTITY',   # == auth_mode "workload_identity"
    workload_identity_provider = 'AWS',    # or 'GCP', 'AZURE', 'OIDC'
)
\`\`\`

The property name varies by tool (Terraform / dbt / the Snowflake providers may say \`snowflake_auth_mode = "workload_identity"\`), but they all drive the same handshake. Note the two sides mirror the general model: the \`CREATE USER ... WORKLOAD_IDENTITY = (TYPE = AWS ARN = ...)\` mapping is Snowflake's **attribute condition** — it pins *which* cloud identity may log in as this user, exactly like the GCP/AWS conditions in §3–§4.

## 6. Why the token can't just be replayed

The security rests on the token being **narrow and short-lived**:

- **Signature** — verified against the issuer's published JWKS; you can't forge one.
- **Audience (\`aud\`)** — the token is minted *for* a specific audience (the target pool/provider). A token scoped to one cloud can't be presented to another.
- **Subject & custom claims (\`sub\`, \`repository\`, \`ref\`, …)** — pinned by the attribute condition, so "my CI" doesn't become "any CI." A token from a fork, a PR branch, or a different repo fails the condition.
- **Expiry (\`exp\`)** — minutes. A leaked token is useless almost immediately, and there's no static key behind it to leak at all.

## 7. Gotchas — the security-review checklist

- **Over-broad attribute condition** — matching only \`assertion.repository_owner\` (or nothing) lets **any repo in the org**, or *any* repo on GitHub, assume your identity. Pin the **full** \`repository\` and usually the \`ref\`/environment. This is the #1 WIF misconfiguration.
- **Forgetting the audience check** — if \`aud\` isn't constrained, a token minted for a different relying party may be accepted. Always validate audience.
- **PR / fork tokens** — pull-request workflows can run with attacker-influenced code; scope conditions to protected branches/environments, not just the repo.
- **\`sub\` format assumptions** — provider \`sub\` strings (e.g. GitHub's \`repo:org/repo:ref:...\` vs \`repo:org/repo:environment:prod\`) differ by trigger; a condition written for one shape silently rejects (or over-accepts) another.
- **Issuer URL / thumbprint drift** — AWS OIDC providers historically pinned a TLS thumbprint; an issuer cert rotation can break federation. Keep the issuer config current.
- **Still minting SA keys "as a backup"** — defeats the purpose; a single leaked fallback key is the whole attack surface you removed. Disable service-account key creation org-wide.
- **Granting the mapped principal too much** — WIF controls *who can assume*; IAM still controls *what they can do*. Scope the assumed role/SA to least privilege — federation is authentication, not authorization.
- **Clock skew / expiry too tight** — very short token lifetimes plus skew can cause flaky exchanges; rely on the platform defaults rather than shrinking blindly.

## 8. The one-paragraph version

"Instead of a long-lived service-account key in a CI secret, the workload presents a short-lived OIDC token its own platform signs — with claims like \`repository\` and \`ref\`. The target cloud has a federation config (GCP Workload Identity Pool provider / AWS IAM OIDC provider / Azure federated credential) that trusts that issuer, verifies the token's signature against the issuer's JWKS, checks the claims against a condition (e.g. \`repository == 'org/repo' && ref == 'refs/heads/main'\`), and exchanges it for temporary credentials via STS. Nothing long-lived exists to leak; the only credential is a minutes-long token bound to a specific workload."
`;
