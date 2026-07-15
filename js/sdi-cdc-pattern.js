// System Design · Patterns — "NoSQL → Data Warehouse CDC Pipeline". A production
// architecture pattern: near-real-time replication from a transactional NoSQL store
// (DynamoDB) into an analytical warehouse (Snowflake) via Streams → EventBridge Pipes
// → Firehose → S3 → Snowpipe, landing raw and projecting into typed views. Rendered
// in the app's Markdown dialect; backticks are escaped (\`) because the whole guide is
// a template literal.
export const SDI_CDC_PATTERN_GUIDE = `# Pattern: NoSQL → Data Warehouse Change-Data-Capture (CDC) Pipeline

A near-real-time replication path from a transactional NoSQL store into an analytical warehouse for downstream reporting and analytics. Multiple source tables converge into a single landing zone, then project into per-entity typed views. The shape is generic — DynamoDB and Snowflake here, but the same topology maps onto Mongo/Cosmos → BigQuery/Redshift. Skim in ~15 minutes; the *decisions* and *failure modes* are the interview-worthy parts.

## Why not just query the transactional store?

An OLTP NoSQL store (DynamoDB) is tuned for high-throughput, key-based point reads and writes — not for scans, joins, or aggregations across the whole dataset. Running analytics on it either throttles the production workload or is impossible (no ad-hoc \`GROUP BY\`). The answer is **CDC**: stream every change out to a columnar analytical store built for exactly those scans, and keep the two decoupled so reporting load never touches the transactional path.

## Data flow (source → sink)

\`\`\`
DynamoDB Table(s)          (transactional store)
     │
     ▼
DynamoDB Streams           (native CDC feed: INSERT / MODIFY / REMOVE)
     │
     ▼
EventBridge Pipes          (per-source-table pipe; owns dispatch & retry)
     │
     ├──► Enrichment Lambda (shared; unmarshals native format, adds audit metadata)
     │
     ▼
Kinesis Data Firehose      (buffers, batches, partitions by time)
     │
     ▼
S3 (object storage)        (Hive-partitioned prefixes, GZIP)
     │
     ▼
Snowpipe                   (auto-ingest on S3 event notification)
     │
     ▼
Landing Table              (raw VARIANT column + audit columns)
     │
     ▼
Typed Views                (per-entity projection, discriminated by a _TYPE column)
     │
     ▼
Downstream Consumers       (BI, analytics, cross-account mirror)
\`\`\`

Each hop earns its place: **Streams** is the native change feed; **Pipes** own per-table dispatch and retry; the **Lambda** normalizes the awkward DynamoDB JSON and stamps provenance; **Firehose** turns a stream of tiny events into well-sized, time-partitioned S3 objects (so Snowflake isn't ingesting millions of 1-KB files); **Snowpipe** auto-loads on arrival; the **landing table + views** split raw capture from curated shape.

## Key architectural decisions

1. **Stream fan-in with a discriminator column.** Multiple independent source tables share one landing table; a \`_TYPE\` column disambiguates event origin. This reduces infra sprawl — one Firehose, one Snowpipe, one landing table — while preserving row-level provenance. The alternative (a full pipeline per table) multiplies cost and operational surface for no analytical benefit.

2. **Raw-variant landing + typed views.** The landing table stores the original event payload as a semi-structured \`VARIANT\` column plus lightweight audit fields (ingest timestamp, source metadata). Curated views project the fields of interest per entity type. This **decouples schema evolution**: adding a new field means updating a view, not rewriting a table or backfilling. The raw payload is always there if a consumer needs a field nobody projected yet.

3. **Feature flag per environment.** The entire pipeline — streams, pipes, Firehose, storage integration, tables, views, grants — is gated behind a single boolean. This lets you stand up landing infrastructure in production *without ingesting* until a dedicated cutover, and cleanly tear it down in ephemeral environments.

4. **Cross-account trust via storage integration.** The AWS ↔ warehouse handshake uses an IAM role assumed by the warehouse's storage integration, keyed on an **external ID** — no stored credentials. The AWS trust policy gates access to the storage-integration identity. Standard confused-deputy defense: the external ID ties the assumed role to *this* integration.

5. **Deduplication at the view layer.** The CDC stream emits an \`INSERT\` and subsequent \`MODIFY\` events for the same logical row when it's updated after creation. The typed views collapse these to one row per business key with \`QUALIFY ROW_NUMBER() OVER (PARTITION BY <key> ORDER BY <event_ts> DESC) = 1\`. The landing table keeps **all** events for audit; the views hide the churn. Dedup at read time, not write time — so the audit trail stays complete.

6. **\`prevent_destroy\` on ingestion-critical resources.** Applied to the stage, landing table, and pipe. Recreating these loses \`LOAD_HISTORY\` (Snowpipe's dedup ledger) → **duplicate ingestion** on the next batch, or drops previously-landed data. A config edit that would trigger destroy-and-recreate has to be caught in review, not discovered in prod.

7. **Explicit variables over string substitution.** Related roles (admin vs read-only) are separate inputs, not one variable with a runtime \`replace()\`. Derived names break silently on a rename; explicit inputs surface the mismatch at plan time.

8. **Boundary validation.** External IDs, storage-integration bindings, and other cross-system handles must be non-empty. Empty defaults silently propagate to trust-policy mismatches that only surface on the **first file delivery** — hours after apply, far from the change that caused them.

## Observability

Every pipe carries its **own** alarm set — no shared alarms across pipes, even when they share the enrichment function — so a fault localizes to one source table.

- **Execution failures** on each Pipe (batch-level processing errors).
- **Iterator age** on each Pipe (consumer lag → risk of the source stream's retention window expiring before you catch up, which is *unrecoverable data loss*).
- **Ingestion failures** at the Snowpipe layer (surfaced via warehouse alerts — out of scope for the CDC infra alarms, but someone must own them).
- **DLQ depth** on the enrichment Lambda for poison-pill events.

## Failure modes to plan for

- **Pipe retry exhaustion → DLQ.** Poison-pill events land in an SQS DLQ; its retention window must exceed the on-call response SLO, or you lose them before anyone looks.
- **Firehose partial delivery → S3 \`errors/\` prefix.** Partition-key extraction failures land under an \`errors/\` prefix instead of the primary path; Snowpipe skips them. Monitor that prefix — silent divergence otherwise.
- **Snowpipe backfill.** Via \`SYSTEM$PIPE_STATUS\` / manual \`ALTER PIPE ... REFRESH\`. Not automated here — it's a documented runbook, invoked when files landed but weren't ingested.
- **Landing-table REMOVE events with a null discriminator.** When the source emits deletes, some unmarshaling paths render \`_TYPE\` null (the new image is absent). Handle with \`COALESCE(newImage._type, oldImage._type)\` if delete events are expected.

## The one-paragraph interview version

"Transactional data lives in DynamoDB; analysts need warehouse-scale queries without touching production. So we CDC it: DynamoDB Streams → EventBridge Pipes (one per table, own retry) → a shared enrichment Lambda that unmarshals and stamps audit metadata → Firehose batches and time-partitions to S3 → Snowpipe auto-ingests into a single landing table with a raw \`VARIANT\` payload and a \`_TYPE\` discriminator. Per-entity typed views project and dedup with \`QUALIFY ROW_NUMBER()\`. The whole thing is feature-flagged per environment, cross-account trust is an assumed IAM role keyed on an external ID (no credentials), and \`prevent_destroy\` guards the stage/table/pipe because losing \`LOAD_HISTORY\` means duplicate ingestion."
`;
