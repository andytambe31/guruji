// CS Fundamentals · Architecture — "Design Patterns: LLM-in-the-loop Event
// Pipeline". A breadth-first refresher on the recurring patterns in a production
// TypeScript / AWS Lambda service that runs LLM generation behind an automated
// review gate. Rendered in the app's Markdown dialect; backticks are escaped
// (\`) because the whole guide is a template literal.
export const CSF_LLM_PATTERNS_GUIDE = `# Design Patterns: LLM-in-the-loop Event Pipeline

Twelve patterns from a real service that generates content with LLMs, gates it through an automated reviewer, and delivers it over a message bus — each generic enough to spot in someone else's codebase. Skim in ~15 minutes; use the *When it breaks* lines as a code-review checklist.

## A. Multi-agent LLM orchestration (orchestrator + specialists)

**What it is** — A lead *orchestrator* decomposes a task into bounded sub-tasks, delegates each to a *specialist* whose system prompt confines it to one domain and data source, then synthesizes their findings into one narrative. The scoping is a hallucination control: a specialist that only sees billing data cannot invent claims about latency.

**Concrete shape**
\`\`\`
                ┌─ specialist: billing ─┐
orchestrator ─► ├─ specialist: usage   ─┤ ─► synthesize ─► narrative
 (decompose)    └─ specialist: errors  ─┘   (orchestrator)
\`\`\`

**Industry standard** — "Orchestrator-workers" (Anthropic, *Building Effective Agents*); "supervisor" graph (LangGraph); "hierarchical process" (CrewAI). Roots in blackboard systems and map-reduce.

**Common alternatives** — One monolithic prompt (cheaper, but context bloat and weaker scoping); a fixed chain (deterministic, less adaptive); an autonomous peer-to-peer swarm (OpenAI Swarm — flexible, harder to bound).

**When it breaks** — Over-decomposition: orchestration cost/latency dwarfs the work. Specialists with overlapping scope double-count or contradict. The synthesizer trusts a low-confidence/empty finding and fabricates a bridge — watch for missing "no data" handling.

## B. Adversarial review / LLM-as-judge with a hybrid rubric

**What it is** — A second evaluator gates the generator's output before the customer sees it. The rubric is tiered: cheap deterministic checks (regex, arithmetic within tolerance, schema validation) run first and short-circuit obvious violations; expensive LLM-judged checks run only for semantic criteria the deterministic layer can't decide. A missing verdict *fails closed* — absence is treated as rejection.

**Concrete shape**
\`\`\`
output ─► [deterministic checks] ──fail──► reject          (cheap, first)
              │ pass
              ▼
          [LLM judge: semantic]  ──fail / missing──► reject (fail-closed)
              │ pass
              ▼
            approve
\`\`\`

**Industry standard** — "LLM-as-a-judge" (Zheng et al., MT-Bench; G-Eval). The cheap-first tiering is a guardrail cascade / short-circuit evaluation (cf. NeMo Guardrails). Fail-closed is a secure default (EIP "Invalid Message Channel").

**Common alternatives** — Human review (higher quality, doesn't scale); pure deterministic validation (no semantic coverage); self-critique by the same model (cheap, shares the generator's blind spots).

**When it breaks** — Judge and generator share a model/prompt family → correlated errors and rubber-stamping. A check that *errors* is treated as pass (fail-open) instead of fail-closed. Tolerance bands so wide the arithmetic check never fires. An LLM invoked for what a regex should own (cost + nondeterminism).

## C. Two-hop event pipeline for gated delivery

**What it is** — The producer publishes to a *candidate* topic, never straight to the customer. A reviewer consumes candidates and, only on approval, republishes to a separate *delivery* topic that the customer-facing consumer subscribes to. The gate is enforced by topology + IAM: the producer has no permission to publish to the delivery topic, so it physically cannot skip the reviewer.

**Concrete shape**
\`\`\`
producer ─► [candidate topic] ─► reviewer ──approve──► [delivery topic] ─► customer
    ✗ no IAM to publish the delivery topic directly
\`\`\`

**Industry standard** — Staged / "quarantine" queues; EIP "Message Filter" + "Content-Based Router" (Hohpe & Woolf, *Enterprise Integration Patterns*). IAM-as-enforcement is a policy enforcement point.

**Common alternatives** — Synchronous in-line review (simpler, but couples the reviewer's latency + uptime to the request path); one topic with a filtering consumer (no hard guarantee the filter runs); a workflow engine (Step Functions) gating the transition.

**When it breaks** — The producer is granted delivery-topic publish "temporarily" → the gate becomes advisory. The reviewer fails silently and blackholes candidates (no DLQ/alarm). Ordering is assumed but topics don't guarantee it.

## D. Idempotency guard via verdict row + follow-up stamp

**What it is** — Buses deliver at-least-once, so the consumer must be idempotent. Each review writes a verdict row keyed by \`(scope, run_id)\`; a redelivery reads the row and short-circuits. A separate \`email_sent\` stamp is written on the *same* row AFTER the downstream publish returns success, so a redelivery arriving outside the bus's dedup window still knows the customer already got the email.

**Concrete shape**
\`\`\`
on message(scope, run_id):
  row = get(scope, run_id)
  if row and row.email_sent: return          # already delivered
  if not row: row = write_verdict(scope, run_id, verdict)
  publish_email(...)                          # side effect
  stamp(row, email_sent = true)               # AFTER success returns
\`\`\`

**Industry standard** — "Idempotent receiver" / idempotency key (EIP; Stripe's idempotency-key API; AWS Lambda Powertools Idempotency). The verdict row is the idempotency store.

**Common alternatives** — Rely on the bus's native dedup window (simple, but time-bounded → fails on late redelivery); transactional outbox / exactly-once (Kafka) where supported; a distributed lock.

**When it breaks** — The two writes are the crux: there is *no* transaction spanning SNS/SES and DynamoDB. Stamp BEFORE publishing → a crash between them loses the email (customer never served). Stamp AFTER → a crash can re-send (at-least-once, tolerable). That's a deliberate at-least-once trade, not a bug — the real mistake is a single write that *assumes* exactly-once.

## E. Single-table DynamoDB → later physical split for a security boundary

**What it is** — Start with one table holding heterogeneous item types distinguished by templated keys (e.g. \`PK=RUN#1, SK=VERDICT#billing\`) — single-table design. Later, hoist one item type (review verdicts) into a physically separate table so a distinct IAM role can own its writes exclusively — a hard boundary that per-item conditions can't fully guarantee.

**Concrete shape**
\`\`\`
before: ┌ table: app ───────────┐   after: ┌ table: app ┐  ┌ table: verdicts ┐
        │ RUN#1  META           │          │ runs, meta │  │ reviewer-role   │
        │ RUN#1  VERDICT#x      │ ─split─► │            │  │ owns all writes │
        └───────────────────────┘          └────────────┘  └─────────────────┘
\`\`\`

**Industry standard** — "Single-table design" (Rick Houlihan, re:Invent DAT401; Alex DeBrie, *The DynamoDB Book*). The split is table-per-bounded-context.

**Common alternatives** — Stay single-table with attribute/condition-scoped IAM (cheaper, softer boundary — see F); one table per entity from day one (relational instinct — loses cross-type transactions and single-query access).

**When it breaks** — Splitting loses cross-type \`TransactWriteItems\` atomicity and cheap single-query fetches — now two round trips or eventual consistency. Splitting for a boundary you don't actually have (no separate owner) is pure cost. Staying single-table when compliance demands write isolation leaves an auditable gap.

## F. Attribute-scoped IAM as defense-in-depth

**What it is** — DynamoDB IAM policies can constrain *which attribute names* a write may touch, via the \`dynamodb:Attributes\` condition key. A deny-list form (\`ForAllValues:StringNotEquals\`) is more maintainable than an allow-list because attributes added by schema evolution aren't accidentally locked out. It sits *behind* the code-level guarantees — belt-and-suspenders, not a replacement.

**Concrete shape**
\`\`\`
Condition:
  "ForAllValues:StringNotEquals":
    "dynamodb:Attributes": ["verdict", "email_sent"]   # may touch anything EXCEPT these
\`\`\`

**Industry standard** — DynamoDB fine-grained access control ("Using IAM policy conditions for fine-grained access control", AWS). General principle: least privilege / defense-in-depth.

**Common alternatives** — Allow-list attributes (tighter, brittle across schema changes); enforce only in code (single point of failure); a separate table (harder boundary — see E).

**When it breaks** — \`ForAllValues\` is subtle: it evaluates the *set* of requested attributes and is vacuously true for an empty set — test the edge cases. Treating attribute-scoping as the *only* guard defeats the "behind the code" intent. Allow-list drift silently blocks legit writes after a schema bump.

## G. Kill switch via alarm-state probe

**What it is** — At the start of every invocation the consumer probes downstream health alarms (CloudWatch \`DescribeAlarms\`) and short-circuits if any are firing — a global stop driven by real system state, not a hand-flipped flag. It *fails open* on API errors: an observability outage (can't read alarm state) must never become a service outage.

**Concrete shape**
\`\`\`
on invoke:
  try: alarms = DescribeAlarms([...])
  except: proceed()                        # fail-open: a CW hiccup must not stop us
  if any(a.state == 'ALARM'): return stop  # kill switch engaged
  proceed()
\`\`\`

**Industry standard** — Circuit breaker (Nygard, *Release It!*), but tripped by external alarm state rather than local error counts. The contrasting pattern is a feature-flag kill switch via SSM Parameter Store (+ an auto-reset Lambda to re-enable).

**Common alternatives** — SSM/AppConfig flag (explicit, manual, survives CW gaps — but someone must flip it); a local error-rate breaker (no cross-service view); no kill switch (big blast radius on a bad deploy).

**When it breaks** — Fail-*closed* on the probe error turns every CloudWatch hiccup into a full outage — the classic review catch. Probing too many alarms adds latency/cost to every invoke. \`INSUFFICIENT_DATA\` mishandled as ALARM (or ignored when it should pause).

## H. Structured findings > freeform prose (specialist output contracts)

**What it is** — Specialists return typed objects against a schema — numbers, enums, arrays — not paragraphs; the orchestrator composes prose from them at the end. Typed output makes agent behavior unit-testable and lets downstream consumers (the review judge) evaluate concrete values instead of parsing text.

**Concrete shape**
\`\`\`
// specialist returns:
{ metric: "p99_latency_ms", value: 812, threshold: 500, breached: true, confidence: 0.9 }
// NOT: "latency looked pretty high this week, around 800ms or so."
\`\`\`

**Industry standard** — Structured output / typed tool schemas (function calling; Anthropic tool use; Instructor, Pydantic-AI, Zod). Contract-first agent design.

**Common alternatives** — Freeform prose + regex/NL parsing downstream (brittle); markdown with agreed headers (semi-structured, still parse-dependent).

**When it breaks** — The model emits prose anyway or invalid JSON → you need schema validation + repair/retry. An over-rigid schema can't express "unknown", so the model guesses a number — design an explicit \`null\`/\`unknown\`. Consumers read the prose narrative instead of the typed fields, defeating the point.

## I. Envelope pattern for cross-service events

**What it is** — Wrap business payloads in a stable metadata envelope — \`{ id, type, source, version, occurred_at, data }\` — before publishing. Consumers dispatch on \`type\`, ignore types they don't handle, and evolve the inner \`data\` shape independently of the envelope contract. The envelope is the stable interface; \`data\` is the versioned variable part.

**Concrete shape**
\`\`\`
{ "id": "...", "type": "review.approved", "source": "reviewer",
  "version": "1", "occurred_at": "2026-...Z",
  "data": { /* payload — evolves independently */ } }
\`\`\`

**Industry standard** — CloudEvents (CNCF): \`id, type, source, specversion, time, data\`. EIP "Message/Command Envelope"; EventBridge's \`source\` / \`detail-type\` / \`detail\`.

**Common alternatives** — Bare payloads (no routing/versioning metadata — brittle); a schema registry with Avro/Protobuf (strong typing + evolution rules, heavier infra); type in the topic name only (lost once messages mix).

**When it breaks** — Consumers that don't check \`type\` process foreign events. Breaking changes made to the *envelope* (vs. \`data\`) ripple to every consumer. No \`version\` field, so \`data\` can't roll forward safely. Missing \`id\` → idempotency (pattern D) has no key.

## J. Embedded Metric Format (EMF)

**What it is** — Emit CloudWatch custom metrics as specially-structured JSON *log lines* instead of calling \`PutMetricData\`. The Logs service parses the embedded \`_aws\` metadata and extracts metrics asynchronously — metrics with no extra API call, no extra IAM permission, and no client-side batching.

**Concrete shape**
\`\`\`
{ "_aws": { "CloudWatchMetrics": [{ "Namespace": "App",
     "Dimensions": [["Service"]], "Metrics": [{ "Name": "Approved", "Unit": "Count" }] }] },
  "Service": "reviewer", "Approved": 1 }        // just log this line
\`\`\`

**Industry standard** — CloudWatch Embedded Metric Format (AWS spec); first-class in AWS Lambda Powertools (\`Metrics\`). Dominant for serverless.

**Common alternatives** — \`PutMetricData\` (synchronous; costs an API call + IAM; needs batching to avoid throttling); OpenTelemetry / ADOT (portable, more moving parts); a StatsD sidecar (awkward in Lambda).

**When it breaks** — Why it wins on serverless: nothing synchronous on the hot path, no throttling/batching, no IAM to manage. Failure modes: cardinality explosion (too many dimension values → metric + cost blowup); metrics silently lost if the line is malformed or the log group has no extraction; double-counting when the same line is re-emitted on retries.

## K. Threat-model-driven design with traceable mitigations

**What it is** — Every non-trivial defensive measure references a documented threat ID (e.g. \`T-02\`, \`LLM-09\`). The threat model is a separate source-of-truth artifact; code comments trace back to it, giving bidirectional traceability — "which threat does this guard address?" and "is every threat mitigated somewhere?"

**Concrete shape**
\`\`\`
// Mitigates T-07 (producer bypasses reviewer): IAM denies producer publish to delivery topic.
// Mitigates LLM-03 (prompt injection via findings): specialist output is typed, never echoed as instructions.
threat-model.md  <=>  code comments   (traceable both ways)
\`\`\`

**Industry standard** — STRIDE (Microsoft: Spoofing, Tampering, Repudiation, Info-disclosure, DoS, Elevation) for security; LINDDUN for privacy; MITRE ATLAS / OWASP Top 10 for LLM for AI threats. Borrowed from safety-critical requirements traceability.

**Common alternatives** — Ad-hoc security review (no coverage guarantee); a checklist (OWASP) not linked to code; attack trees. Trade: rigor + auditability vs. upkeep.

**When it breaks** — The model goes stale (code evolves, threats don't) → the traceability lies. Mitigations cite threats no one actually analyzed (cargo-cult IDs). Coverage gaps hide because no one checks the reverse direction (every threat → a control).

## L. Cross-account STS with an external ID from a secrets store

**What it is** — To reach a resource in another AWS account (e.g. a foundation-model provider), the service assumes a role there via STS instead of holding static keys. The role's trust policy requires an \`ExternalId\`, read from a secrets store at runtime; STS issues short-lived credentials — so nothing long-lived lands in Terraform state, env vars, or CI logs.

**Concrete shape**
\`\`\`
externalId = secrets.get("provider/external-id")            # runtime, not in TF/env
creds = sts.AssumeRole(RoleArn = ..., ExternalId = externalId)  # temporary, auto-expiring
callProvider(creds)
\`\`\`

**Industry standard** — AWS cross-account \`sts:AssumeRole\` with \`ExternalId\` (the confused-deputy prevention pattern); secret in AWS Secrets Manager / SSM SecureString. IAM Roles Anywhere for non-AWS callers.

**Common alternatives** — Static IAM user access keys (long-lived, leak-prone, rotation burden); resource-based sharing without STS; OIDC federation (for workloads with an identity provider).

**When it breaks** — External ID committed to Terraform/env → confused-deputy protection is defeated and it's now just a static secret. Not caching STS creds → throttling/latency every call; caching past expiry → auth failures. An over-broad assumed role (it should be least-privilege in the *target* account).

---

**Reviewing someone else's pipeline?** The tells: a producer with direct delivery-topic rights (C broken), a single write assuming exactly-once (D), fail-*closed* health probes (G), an LLM judge sharing the generator's model (B), and consumers that don't switch on \`type\` (I).`;
