// System Design · Patterns — "Scaling to 1 Million Users: a capacity walkthrough".
// A milestone-driven, numbers-first companion to the encyclopedic ch02 "Scale From
// Zero To Millions" reference: start on one box and, at each growth stage, name what
// breaks and what you add — with the back-of-envelope math that anchors the choices.
// Rendered in the app's Markdown dialect; backticks are escaped (\`).
export const SDI_SCALE1M_GUIDE = `# Scaling to 1 Million Users — a capacity walkthrough

The strong interview answer to "design X for a million users" is **not** a topic dump. It's a narrative: start on one box, and at each growth milestone say *what breaks first* and *the smallest thing you'd add to fix it* — anchored by rough numbers so the choices aren't arbitrary. This guide is that narrative. (For the topic-by-topic reference — load balancers, replication, CDN, etc. — see the ByteByteGo chapter "Scale From Zero To Millions Of Users" in this track.) Skim in ~15 minutes.

## 0. Lead with the napkin math

Before drawing boxes, size the load out loud — it decides everything downstream.

- **QPS:** \`DAU × requests/user/day ÷ 86,400\`. For **1M DAU** at ~10 requests each: \`10M ÷ 86,400 ≈ 116 QPS average\`. Multiply by a **peak factor of ~3–5×** → **~350–600 QPS peak**.
- **Storage:** \`users × bytes/user\`. 1M users × a few KB of profile ≈ **single-digit GB**; add media/history and it grows, but the core row store stays small.
- **The key realization:** *1M users is only a few hundred QPS.* One well-tuned database with a cache and a couple of replicas handles that comfortably — you do **not** need to shard at 1M. Saying this shows you reason about scale instead of reflexively reaching for the heaviest tool.

State your assumptions (read/write ratio, payload size, peak factor) and the interviewer will correct them if needed — that dialogue *is* the signal.

## 1. Stage 0 — a single server

Everything on one box: web server, app, and database, DNS pointing at its IP.

- **Fine for:** the first handful of users / a demo.
- **What breaks first:** it's a **single point of failure**, and the web app and DB fight for the same CPU/RAM. One traffic spike or one heavy query takes the whole thing down.

## 2. Stage 1 — split the tiers

Move the **database onto its own server**, separate from the web/app tier. Now each can be sized and scaled independently, and a runaway query no longer starves request handling.

- **Pick the data store:** default to **SQL** (transactions, joins, a schema that catches bugs). Reach for **NoSQL** only for a specific need — massive write scale, a flexible/denormalized shape, or a key-value/wide-column/document access pattern. At 1M users SQL is almost always right.

## 3. Stage 2 — redundancy + a load balancer

Add a **second web server behind a load balancer**. Users hit the LB's public IP; it spreads traffic and routes around a dead server. No more web-tier SPOF, and you can add servers horizontally as QPS climbs.

- **Make the web tier stateless.** If a server keeps session state locally, requests must pin to it (sticky sessions) — fragile and hard to autoscale. Push session state to a **shared store (Redis/DB)** so any server serves any request. *This is the unlock for horizontal scaling.*

## 4. Stage 3 — scale the database with replication

The web tier scales out trivially; the **database is the bottleneck**. Most apps read far more than they write, so add **read replicas**: the **primary takes writes**, replicas serve reads.

- Reads scale with replica count; you also gain redundancy.
- **Failover:** if the primary dies, promote a replica — but its data may be slightly stale (replication lag), so promotion is recovery, not a clean flip.

## 5. Stage 4 — cache + CDN (the biggest wins for read-heavy load)

- **Cache layer (e.g. Redis)** in front of the DB, **cache-aside**: on a read, check cache → on miss, read DB and populate → set a **TTL**. Slashes DB load and latency. Name your **staleness budget** and an eviction policy (LRU); remember cache **invalidation** is the hard half.
- **CDN** for static assets (images/CSS/JS/video): served from an **edge** near the user. First request fills the edge from origin (with a TTL); everyone after is local — huge latency win, less origin load. Version URLs (\`img.png?v=2\`) to bust before the TTL.

At this point a few hundred QPS is easy: most reads hit cache or the CDN and never reach the primary.

## 6. Stage 5 — multiple data centers

For availability and global latency, run in **2+ data centers / regions**. **geoDNS** routes users to the nearest; if one region fails, traffic reroutes to another.

- The hard part is **data**: cross-region replication, and keeping data consistent (or deciding what may be eventually consistent). This is where you invoke **CAP** — during a partition, choose consistency *or* availability per data type.

## 7. Stage 6 — decouple with a message queue

As features grow, put a **message queue** between producers and slow/spiky consumers (email, image processing, notifications). The web tier drops a job on the queue and returns immediately; **worker pools** consume independently.

- Buys **async processing, burst buffering, and retries**, and decouples component uptime — at the cost of **eventual** (not immediate) consistency for that work.

## 8. Stage 7 — when the write path finally hurts: shard

Only once a single primary can't hold the **write** volume or the **data size** (well beyond 1M users for most apps): **shard** the database — split *different* rows across nodes by a shard key (e.g. \`user_id\`).

- Cost: cross-shard queries and joins get hard; re-sharding is painful. Choose the shard key to spread load evenly.
- **Watch the hot shard / celebrity problem:** one key (a viral user) can melt its shard even when the fleet is idle — consider write-sharding that key.
- Order of operations: **replicate first, cache aggressively, then shard** — sharding is the last resort, not the first.

## 9. Running underneath it all

- **Logging, metrics, monitoring, automation** from early on — you can't scale what you can't see. Alert on QPS, latency percentiles (p95/p99), error rate, replica lag, cache hit rate.
- **No single point of failure:** at least two of everything (LB, web, cache, DB) across zones, with a way to fail over.

## 10. The 1M-user snapshot

Putting it together, a solid architecture at ~1M DAU / a few hundred peak QPS:

\`\`\`
        geoDNS
          │
     [ load balancer ]           (≥2, across zones)
          │
   [ stateless web tier ]        (N servers, autoscaled)
      │            │
 [ Redis cache ]  session store
      │
 [ primary DB ] ──► [ read replicas ]
      │
 [ message queue ] ─► [ workers ]     CDN serves static/media at the edge
\`\`\`

Note what's **absent**: no sharding yet. A cached, replicated single primary behind a stateless web tier is plenty for 1M users — you add sharding only when the *write* path proves it needs it.

## 11. The one-paragraph version

"First I'd size it: 1M DAU at ~10 requests each is ~116 QPS average, call it ~500 peak — only a few hundred QPS, so one primary DB with a cache and replicas is enough; no sharding needed yet. I'd start with separate web and DB tiers, put the web tier behind a load balancer and make it **stateless** (sessions in Redis) so it scales horizontally. Reads dominate, so **read replicas**, a **cache-aside** layer, and a **CDN** for static assets carry most of the load. For availability I'd run **multiple regions** with geoDNS, and decouple slow work (email, media) behind a **message queue** with workers. Sharding, and dealing with hot shards, only comes if the write path or data size outgrows a single primary — well past a million users for most apps. Throughout: no single point of failure, and metrics on latency percentiles, error rate, replica lag, and cache hit rate."
`;
