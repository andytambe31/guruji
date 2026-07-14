// CS Fundamentals · Databases — "DynamoDB: how it actually works". A breadth-first
// operator's reference: the storage model, single-table design (and the OneTable
// library), secondary indexes, and the durability / safety knobs (PITR, deletion
// protection, TTL, streams). Rendered in the app's Markdown dialect; backticks are
// escaped (\`) because the whole guide is a template literal.
export const CSF_DYNAMODB_GUIDE = `# DynamoDB: how it actually works

A managed, serverless, key-value + document database that gives single-digit-millisecond reads at any scale — *if* you model for its access patterns up front. The whole design follows from one fact: **data is spread across partitions by a hash of the key, and every fast query must name a key.** There are no joins and no ad-hoc \`WHERE\` on arbitrary columns; you design the keys to answer the questions you'll ask. Skim in ~15 minutes; treat the *Gotchas* lines as a design-review checklist.

## 1. The storage model — partitions and keys

Every table has a **primary key**, which is one of two shapes:

- **Partition key only** (a "simple" key) — e.g. \`userId\`. The item lives on whichever physical partition \`hash(userId)\` maps to.
- **Partition key + sort key** (a "composite" key) — e.g. \`(userId, createdAt)\`. All items sharing a partition key live together on one partition, **sorted by the sort key**. This co-located, sorted set is an **item collection**.

The partition key is also called the **hash key**; the sort key the **range key**. Reads are fast because DynamoDB hashes the partition key to jump straight to the right partition, then binary-searches the sort key. A read that can't name a partition key is a **Scan** — it reads the whole table.

\`\`\`
                       hash(PK)
   PK=alice ─────────────► partition 3 ─► [ (alice, 2024-01) (alice, 2024-02) … ]  ← sorted by SK
   PK=bob   ─────────────► partition 7 ─► [ (bob, 2024-01) … ]
\`\`\`

**Query vs Scan** — \`Query\` targets one partition key and optionally a sort-key condition (\`begins_with\`, \`between\`, \`>\`); it's O(items returned). \`Scan\` walks every partition; it's O(table) and you almost never want it in a hot path.

## 2. Access patterns first, schema second

Relational modeling normalizes and joins at read time. DynamoDB inverts this: **you list every access pattern before choosing keys**, then shape the keys so each pattern is a single \`Query\`. Ask, for the app:

- "Get a user by id" → \`PK = USER#<id>\`
- "List a user's orders, newest first" → \`PK = USER#<id>, SK begins_with ORDER#\`, query descending
- "Get one order with its line items" → put the order and its items in **one item collection** so a single query returns all of them.

If a new access pattern shows up later that the keys don't serve, you add a **secondary index** (§4) or a new item type — you don't restructure the table.

## 3. Single-table design & OneTable

**Single-table design** means storing many *entity types* (users, orders, products) in **one** physical table, distinguished by key *prefixes* rather than separate tables. Generic key attributes — usually named \`PK\` and \`SK\` — hold typed, prefixed values:

| PK | SK | entity |
|---|---|---|
| \`USER#42\` | \`USER#42\` | user profile |
| \`USER#42\` | \`ORDER#1001\` | an order for user 42 |
| \`USER#42\` | \`ORDER#1001#ITEM#3\` | a line item |
| \`ORG#7\` | \`USER#42\` | membership edge |

Why do this: a single \`Query\` on \`PK = USER#42\` returns the profile **and** its orders in one round-trip (they're one item collection), no joins. The trade-off is that the raw table is unreadable to humans and every query must respect the key encoding.

**OneTable** ([sensedeep/dynamodb-onetable](https://github.com/sensedeep/dynamodb-onetable)) is a JavaScript/TypeScript library that makes single-table design tolerable. You declare an **entity schema** — field names, types, required/default, and **key templates** — and OneTable maps friendly attributes onto the generic \`PK\`/\`SK\` for you:

\`\`\`js
const schema = {
  version: '1.0.0',
  indexes: { primary: { hash: 'PK', sort: 'SK' } },
  models: {
    Order: {
      PK:  { type: String, value: 'USER#\${userId}' },
      SK:  { type: String, value: 'ORDER#\${orderId}' },
      userId:  { type: String, required: true },
      orderId: { type: String, generate: 'ulid' },
      total:   { type: Number },
    },
  },
};
// Reads/writes speak the entity, not PK/SK:
await Order.create({ userId: '42', total: 99 });
await Order.find({ userId: '42' });   // → Query PK = USER#42, SK begins_with ORDER#
\`\`\`

What OneTable buys you: **key templating** (never hand-concatenate \`USER#\` again), type marshalling and validation, default/generated values (ULID/UUID), a typed API, and helpers for pagination and transactions. What it does **not** change: it's still DynamoDB underneath — the access patterns still have to be designed, and a query OneTable can't satisfy is still a Scan.

## 4. Secondary indexes — GSI and LSI

An index is a **second view of the table under a different key**, so you can query by something other than the base primary key.

**Global Secondary Index (GSI)** — a *completely different* partition + sort key. It's maintained as a separate, asynchronously-replicated copy of the table.
- Keys are independent of the base table; you can have up to 20 per table.
- **Eventually consistent only** — writes propagate to the GSI a moment after the base write; you can't ask a GSI for a strongly-consistent read.
- Has its **own capacity/throttling**. If a GSI is under-provisioned it can throttle and, in provisioned mode, back-pressure onto base-table writes.
- **Projection** controls which attributes are copied into the index: \`KEYS_ONLY\`, \`INCLUDE\` (a named subset), or \`ALL\`. Anything not projected requires a second fetch from the base table.
- The classic single-table trick: **overloaded GSIs** — generic index keys named \`GSI1PK\`/\`GSI1SK\` that different entity types populate with different meanings, so one index serves several access patterns.

**Local Secondary Index (LSI)** — **same partition key**, a *different sort key*. Shares the base partition, so:
- Can be **strongly consistent** (it lives on the same partition).
- Must be created **at table-creation time** — you can't add or drop an LSI later.
- Counts against the **10 GB per-partition item-collection limit** (a partition key's items + all its LSI entries must fit in 10 GB).
- Max 5 per table.

| | GSI | LSI |
|---|---|---|
| Partition key | different | **same** as base |
| Sort key | different | different |
| Consistency | eventual only | strong available |
| When created | anytime | **table creation only** |
| Capacity | its own | shares the base table's |
| Per-table limit | 20 | 5 |

**Rule of thumb:** reach for a **GSI** unless you specifically need strong consistency on the alternate key *and* you can commit to it at table creation — then LSI. In practice most teams use GSIs almost exclusively.

## 5. Capacity, consistency, throttling

- **On-demand** mode: pay per request, no capacity planning, instant scaling. Default choice for spiky or unknown traffic.
- **Provisioned** mode: you set **RCUs / WCUs** (read/write capacity units), optionally with auto-scaling. Cheaper at steady, predictable, high volume. 1 RCU = one 4 KB strongly-consistent read/sec (or two eventually-consistent); 1 WCU = one 1 KB write/sec.
- **Consistency:** reads are **eventually consistent by default**; pass \`ConsistentRead: true\` for a **strongly-consistent** read from the base table (costs 2×, not available on GSIs).
- **Hot partitions:** because throughput is spread across partitions, a key that concentrates traffic (e.g. \`PK = TODAY\`) can throttle even when the table's total capacity is fine. **Adaptive capacity** absorbs some skew, but the fix is a **high-cardinality partition key** (or write-sharding: \`PK = TODAY#<0..N>\`).

## 6. Point-in-Time Recovery (PITR)

**PITR** is continuous backup: once enabled, DynamoDB retains a rolling change log so you can **restore the table to any second within the last 35 days**.

- Restores create a **brand-new table** — PITR never overwrites the live one in place, so recovery is non-destructive.
- It protects against **application-level corruption** (a bad deploy that mangles rows, an accidental bulk delete) and accidental table drops, not just infra failure.
- It's a per-table toggle (\`PointInTimeRecoverySpecification\`), cheap, and there's **no performance impact** on the live table — treat "PITR on" as the default for anything that matters.
- Distinct from **on-demand backups** (manual, full snapshots you keep indefinitely) and from **AWS Backup** integration. PITR = fine-grained + rolling 35 days; on-demand = coarse + kept as long as you like.

**Gotcha:** enabling PITR does **not** retroactively cover the past — the 35-day window starts when you turn it on. And a restore can take a while for large tables; it is not an instant failover.

## 7. Deletion protection & other safety knobs

- **Deletion protection** — a table-level flag (\`DeletionProtectionEnabled\`) that makes \`DeleteTable\` fail until someone explicitly turns it off. It stops the "wrong table in the wrong account / fat-fingered Terraform destroy" class of accident. It guards the **table**, not the items — it does nothing about \`DeleteItem\`. Turn it on for every production table; pair it with PITR so you're covered against both "table dropped" and "rows corrupted".
- **TTL (Time To Live)** — name an attribute holding a Unix-epoch timestamp; DynamoDB deletes items **after** that time, for free, in the background (best-effort, typically within ~48 h — *not* a precise scheduler). Great for sessions, ephemeral caches, GDPR-style expiry. TTL deletes flow through Streams (with a system-generated principal), so you can react to expiry.
- **Conditional writes** — \`ConditionExpression\` (e.g. \`attribute_not_exists(PK)\`) makes a write happen only if a predicate holds; the basis for optimistic locking and idempotent inserts.
- **IAM** — fine-grained access down to specific items/attributes via condition keys like \`dynamodb:LeadingKeys\`.

## 8. Streams & transactions

- **DynamoDB Streams** — an ordered, 24-hour change log of item-level modifications (\`NEW_IMAGE\`, \`OLD_IMAGE\`, or both). Consumed by Lambda (event-source mapping) for CDC: fan-out, search-index sync, aggregation, cross-region replication. **Global Tables** (multi-region, active-active) are built on Streams.
- **Transactions** — \`TransactWriteItems\` / \`TransactGetItems\` give **all-or-nothing** writes across up to 100 items (even across tables), with ACID semantics in one region. They cost 2× the equivalent single writes and can fail on \`TransactionConflict\` under contention — use them for genuine invariants (e.g. "debit A and credit B together"), not as a default.

## 9. Gotchas — the design-review checklist

- **Scan in a hot path** — almost always a modeling miss; you needed a key or a GSI.
- **Low-cardinality partition key** → hot partition and throttling despite spare capacity.
- **GSI under-provisioned** (provisioned mode) → it throttles and can back-pressure base writes.
- **Assuming a GSI is strongly consistent** — it never is; a read-after-write against a GSI can miss the just-written item.
- **LSI added "later"** — impossible; LSIs are creation-time only. If you didn't plan it, it's a GSI now.
- **Item > 400 KB** — the hard per-item size limit. Large blobs belong in S3 with a pointer in the item.
- **Item collection > 10 GB** — only bites when an LSI exists; that partition key can't grow past 10 GB.
- **PITR window misunderstood** — 35 days, starts at enable time, restores to a *new* table (update your app's table name or alias on recovery).
- **Deletion protection ≠ item protection** — it blocks \`DeleteTable\`, not \`DeleteItem\`. For row-level safety you want conditional writes, backups, and PITR.
- **TTL treated as a precise timer** — it's best-effort within ~48 h, not a cron; don't rely on exact expiry timing.
`;
