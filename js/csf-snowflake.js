// CS Fundamentals · Databases — "Snowflake: how it actually works". A breadth-first
// operator's reference: the decoupled storage/compute architecture, micro-partitions
// and pruning, virtual warehouses and the caching layers, and the differentiating
// features (Time Travel, zero-copy cloning, data sharing, Snowpipe). Rendered in the
// app's Markdown dialect; backticks are escaped (\`) because the whole guide is a
// template literal.
export const CSF_SNOWFLAKE_GUIDE = `# Snowflake: how it actually works

A cloud data warehouse (now "data cloud") whose entire design follows from one decision: **separate storage from compute, and both from the service brain.** You keep one copy of the data in cloud object storage, and spin up any number of independent compute clusters over it — each sized and scaled on its own, none contending with the others. That decoupling is what makes "a thousand analysts querying while a batch job loads" a non-event. Skim in ~15 minutes; treat the *Gotchas* lines as a design/cost-review checklist.

## 1. The three-layer architecture

Snowflake splits into three independently-scaling layers:

\`\`\`
   ┌──────────────────────────────────────────────┐
   │  Cloud Services  — brain: auth, optimizer,    │  (metadata, no user data)
   │  metadata, txn mgmt, result cache, security   │
   ├──────────────────────────────────────────────┤
   │  Compute (Virtual Warehouses) — MPP clusters, │  (many, independent, elastic)
   │  each a set of nodes; ephemeral, per-workload │
   ├──────────────────────────────────────────────┤
   │  Storage — columnar micro-partitions in cloud │  (one copy, S3/GCS/Blob)
   │  object storage (S3 / GCS / Azure Blob)        │
   └──────────────────────────────────────────────┘
\`\`\`

- **Storage** — your tables live as compressed, columnar files ("micro-partitions", §3) in the cloud provider's object store. Storage is billed by the TB and is completely independent of compute.
- **Compute** — a **virtual warehouse** is an MPP cluster you provision on demand to run queries. Warehouses don't share data or cache with each other; ten teams get ten warehouses that never contend. Compute is billed per-second while running.
- **Cloud Services** — the always-on control plane: the query optimizer, metadata catalog, transaction manager, authentication/RBAC, and the result cache. It never touches raw user data on the compute path; it's what lets many warehouses agree on one consistent view.

The point of decoupling: **you scale the layer that's the bottleneck.** More data? Storage grows, compute cost is unchanged. More concurrent queries? Add warehouses, storage is untouched.

## 2. Virtual warehouses — sizing and scaling

A warehouse is a T-shirt-sized cluster: **XS, S, M, L, XL, …** Each size up **doubles the nodes** (and roughly the credits/hour), so an M runs a query about twice as fast as an S for ~2× the per-hour cost — the *total* credits for a fixed amount of work are often similar; you're buying **latency**, not throughput-per-dollar.

- **Auto-suspend / auto-resume** — a warehouse suspends after N idle seconds (you stop paying) and resumes on the next query. Set auto-suspend low (e.g. 60 s) for interactive warehouses; you only pay while it's actually running.
- **Scale *up* (bigger size)** — for a single heavy/complex query that needs more memory and parallelism.
- **Scale *out* (multi-cluster warehouse)** — for **concurrency**: Snowflake adds *more clusters of the same size* automatically as the queued query load rises, then removes them as it falls. This solves "100 people hit the dashboard at 9am," which a bigger single cluster does not.
- **Separate warehouses per workload** — a common pattern is a dedicated loading warehouse, a BI warehouse, and an ad-hoc/data-science warehouse, so a runaway query in one never starves the others.

## 3. Micro-partitions & pruning — why it's fast

Snowflake has **no manual indexes and no manual partitioning.** Instead every table is automatically divided into **micro-partitions**: immutable, columnar files of ~**50–500 MB of uncompressed data** (~16 MB compressed) each. For every micro-partition, Cloud Services stores **metadata**: the min/max value of each column, distinct counts, null counts.

That metadata drives **partition pruning**: when a query filters \`WHERE order_date = '2024-01-01'\`, the optimizer reads the min/max metadata and **skips every micro-partition whose range can't contain that date** — often reading a few files out of millions, without ever touching the data. This is the core of Snowflake performance and it's fully automatic.

- **Columnar** storage means a query that selects 3 of 200 columns reads only those 3 columns' data.
- Micro-partitions are **immutable**: an \`UPDATE\`/\`DELETE\` rewrites whole micro-partitions rather than mutating in place — which is exactly what makes **Time Travel** (§5) cheap.

## 4. Clustering — for very large tables

Data is naturally co-located by load order, which is usually enough. For **large tables (multi-TB)** where the query filter doesn't line up with load order, pruning degrades. Two tools:

- **Clustering keys** — you declare a key (e.g. \`CLUSTER BY (event_date, tenant_id)\`), and Snowflake's **automatic clustering** service reorganizes micro-partitions in the background so values are co-located, restoring tight min/max ranges and good pruning. It costs credits — only cluster large tables with a clear, selective filter pattern.
- **Search Optimization Service** — a separate paid add-on that builds a persistent index-like structure for **point lookups / highly-selective equality** on big tables (e.g. "find this one customer id").

**Rule of thumb:** don't cluster until pruning is measurably bad on a large table; for most tables the automatic layout is fine.

## 5. Time Travel & Fail-safe

Because micro-partitions are immutable, Snowflake keeps old versions cheaply.

- **Time Travel** — query or restore a table **as of a past point in time**, up to a retention window: **1 day on Standard, up to 90 days on Enterprise+**. You can \`SELECT ... AT (TIMESTAMP => …)\`, \`SELECT ... BEFORE (STATEMENT => …)\`, or **\`UNDROP TABLE\`** to recover from an accidental drop or bad \`DELETE\` in seconds. This is the "oops" button.
- **Fail-safe** — a further **7-day**, Snowflake-managed window *after* Time Travel expires, from which **only Snowflake support** can recover data (disaster recovery, not self-service). You can't query it and can't turn it off; it's why dropped data keeps costing storage for a week.

\`\`\`
  live data ──► Time Travel (0–90 days, self-service) ──► Fail-safe (7 days, support only) ──► gone
\`\`\`

## 6. Zero-copy cloning

\`CREATE TABLE ... CLONE\` (also databases and schemas) makes an **instant, metadata-only copy** — it points at the *same* micro-partitions rather than duplicating bytes, so it's near-free and immediate even for a huge table. Storage only grows as the clone **diverges**: changed micro-partitions are written fresh (copy-on-write); unchanged ones stay shared.

Uses: spin up a full-size **dev/test copy of prod** in seconds, take a **pre-deploy snapshot** to roll back to, give each analyst a sandbox. Gotcha: a clone is a point-in-time fork — it does **not** stay in sync with the source afterward.

## 7. Caching — three layers

1. **Result cache** (Cloud Services) — identical query + unchanged underlying data → the exact result is returned from a global cache in milliseconds, **using no warehouse compute at all**. Lives ~24 h.
2. **Local disk / warehouse cache (SSD)** — a running warehouse caches the micro-partitions it has read on its nodes; repeat queries over the same data skip re-fetching from object storage. **Lost when the warehouse suspends** — a cost/latency trade-off in setting auto-suspend.
3. **Remote storage** — the durable source of truth in object storage.

## 8. Data sharing, loading, and semi-structured data

- **Secure Data Sharing** — grant another Snowflake account **live, read-only access to your data with no copy and no ETL**; they query it from their own warehouse (they pay the compute, you keep one copy). The **Marketplace** is this productized. Because there's no copy, the consumer always sees current data.
- **Loading** — bulk with **\`COPY INTO\`** from a **stage** (an S3/GCS/Azure location or internal stage); continuous with **Snowpipe** (auto-ingest on file arrival, serverless, billed per-file). **Streams** (change tracking / CDC) + **Tasks** (scheduled SQL / DAGs) build incremental pipelines; **Dynamic Tables** declare a target and let Snowflake maintain the refresh.
- **Semi-structured data** — the **\`VARIANT\`** type stores JSON/Avro/Parquet natively; you query nested fields with dot/bracket paths (\`col:user.id\`, \`col['items'][0]\`) and \`FLATTEN\`, and Snowflake transparently columnarizes common paths for pruning.

## 9. Cost model & governance

- **Billing = credits (compute) + $/TB (storage) + a little cloud-services + serverless features.** Compute dominates and is **per-second while a warehouse runs** — so idle warehouses with high auto-suspend are the classic bill surprise.
- **Levers:** low auto-suspend, right-sized warehouses, multi-cluster for concurrency (not oversizing), **resource monitors** to cap credits and alert/suspend on a budget, and leaning on the **result cache** (free).
- **Governance:** role-based access control (RBAC), column/row-level security, dynamic data masking, and object **tags** for classification.

## 10. Gotchas — the design / cost-review checklist

- **Warehouse left running** with a long auto-suspend → paying for idle time. Set auto-suspend to ~60 s for interactive use.
- **Oversizing to fix concurrency** — a bigger warehouse speeds one query; it does **not** fix "many users queuing." Use a **multi-cluster** warehouse for concurrency.
- **Clustering everything** — automatic clustering costs credits; only cluster large tables with a selective filter that doesn't match load order.
- **Assuming a clone stays in sync** — zero-copy clone is a point-in-time fork; it diverges and never re-syncs.
- **\`SELECT *\` on wide tables** — defeats columnar pruning; select only the columns you need.
- **Forgetting Fail-safe storage** — dropped/changed data keeps billing storage through Time Travel **and** the 7-day Fail-safe window; you can't shorten Fail-safe.
- **Non-selective filters / functions on the filter column** — wrapping the filtered column in a function can prevent min/max pruning, so it scans everything.
- **Result cache misses you expected to hit** — any change to the underlying data, the query text, or session context invalidates it.
- **Treating Time Travel as backup** — it's a rolling window (max 90 days) and account-local; for long-term or cross-region DR, use replication/backups, not Time Travel alone.
`;
