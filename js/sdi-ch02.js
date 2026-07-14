// Chapter 02 — "Scale From Zero To Millions Of Users" (ByteByteGo course),
// rendered as a study guide in the app's Markdown dialect. Kept in its own
// module so the large string stays out of the seed logic. Backticks are escaped
// (\`) because the whole guide is a template literal.
export const CH02_SCALE_GUIDE = `# 02 · Scale From Zero To Millions Of Users

Designing a system that supports millions of users is a journey of continuous refinement. We start with a single user and gradually scale up to serve millions. By the end you'll own a handful of techniques that crack a lot of system-design questions.

## Single server setup

Everything — web app, database, cache — runs on one box. To understand it, follow the **request flow** and the **traffic source**.

The request flow:

1. Users reach the site through a **domain name** (e.g. \`api.mysite.com\`). DNS is usually a paid 3rd-party service, not hosted by you.
2. **DNS returns an IP** (e.g. \`15.125.23.214\`) to the browser or mobile app.
3. Once the IP is known, **HTTP** requests go straight to your web server.
4. The web server returns **HTML** (or a **JSON** response) for rendering.

Traffic comes from two sources:

- **Web application** — server-side languages (Java, Python…) for business logic + storage, client-side (HTML/JS) for presentation.
- **Mobile application** — talks to the server over HTTP; **JSON** is the common API response format for its simplicity.

Example — \`GET /users/12\` returns the user object for id 12:

\`\`\`
{
  "id": 12,
  "firstName": "John",
  "lastName": "Smith",
  "address": {
    "streetAddress": "21 2nd Street",
    "city": "New York",
    "state": "NY",
    "postalCode": 10021
  },
  "phoneNumbers": ["212 555-1234", "646 555-4567"]
}
\`\`\`

## Database

With growth, one server isn't enough. Split **web tier** (web/mobile traffic) from **data tier** (database) so each scales independently.

**Which database?** Relational vs. non-relational:

| | Relational (SQL / RDBMS) | Non-relational (NoSQL) |
|---|---|---|
| Examples | MySQL, Oracle, PostgreSQL | CouchDB, Neo4j, Cassandra, HBase, DynamoDB |
| Model | tables + rows, **joins** across tables | key-value, graph, column, document — **no joins** |
| Track record | 40+ years, works well for most apps | newer; shines in specific cases |

Reach for **NoSQL** when:

- Your app needs super-low latency.
- Your data is unstructured, or not relational.
- You only need to serialize/deserialize objects (JSON, XML, YAML).
- You must store a massive amount of data.

## Vertical vs. horizontal scaling

- **Vertical ("scale up")** — add CPU/RAM to one server. Simple, great at low traffic, but: a **hard ceiling**, and **no failover/redundancy** — if the box dies, the app dies with it.
- **Horizontal ("scale out")** — add more servers. More desirable at scale precisely because it dodges vertical's limits.

Users connected directly to a single web server lose access the moment it's offline — or hit slow responses when it's overloaded. A **load balancer** solves both.

## Load balancer

A load balancer evenly spreads incoming traffic across a set of web servers. Clients hit the load balancer's **public IP**; the load balancer reaches the web servers over **private IPs** (reachable only inside the network — better security).

Adding a load balancer + a second web server fixes failover and improves availability:

- If **server 1 dies**, traffic routes to server 2; the site stays up (add a fresh server back to the pool).
- If **traffic spikes**, just add more servers to the pool — the balancer starts routing to them automatically.

The web tier is solid now, but the single database still has no failover. **Replication** fixes that.

## Database replication

Typically a **master/slave** relationship: the **master** takes writes (insert/update/delete); **slaves** hold read-only copies. Most apps read far more than they write, so slaves usually outnumber masters.

Advantages:

- **Performance** — writes on the master, reads spread across slaves → more queries in parallel.
- **Reliability** — data survives a lost server (disaster in one location).
- **High availability** — the site keeps serving from another replica if one is offline.

What if a database goes offline?

- **A slave dies** — reads temporarily go to another healthy slave (or the master if it was the only slave); replace the dead one.
- **The master dies** — a slave is **promoted** to master; all operations run there while a new slave spins up. In production this is trickier: the promoted slave's data may be stale, so recovery scripts backfill the gap. (Multi-master and circular replication exist but are more complex.)

Full picture so far: a user gets the LB's IP from DNS → connects → HTTP routes to a web server → reads come from a **slave**, writes/updates/deletes go to the **master**.

Next, improve response time with a **cache** and a **CDN**.

## Cache

A cache is a fast, temporary store for expensive or frequently-read results, so later requests skip the database.

**Cache tier** — a separate, much-faster layer that also lets you scale caching independently. Flow (a **read-through** cache): the web server checks the cache; **hit** → return it; **miss** → query the DB, store the result in cache, then return it.

Typical Memcached usage:

\`\`\`
SECONDS = 1
cache.set('myKey', 'hi there', 3600 * SECONDS)
cache.get('myKey')
\`\`\`

Considerations:

- **When to cache** — data read often but modified rarely. Cache is volatile (a restart loses everything), so persist important data in a real store.
- **Expiration policy** — expire cached data so it doesn't live forever. Too short → hammers the DB; too long → data goes stale.
- **Consistency** — keeping store and cache in sync is hard, especially across regions, because the two writes aren't one transaction. (See Facebook's *Scaling Memcache*.)
- **Single point of failure (SPOF)** — one cache server is a SPOF. Run multiple across data centers, and over-provision memory as a buffer.
- **Eviction policy** — when full, adding evicts something. **LRU** (least-recently-used) is most common; **LFU** and **FIFO** suit other cases.

## Content delivery network (CDN)

A CDN is a network of geographically distributed servers that cache **static content** (images, video, CSS, JS). The closer the edge, the faster the load — San Francisco origin serves LA faster than Europe.

How it works:

1. A user requests \`image.png\` via a CDN-provided URL (e.g. \`https://mysite.cloudfront.net/logo.jpg\`).
2. **Cache miss** → the CDN fetches the file from the origin (web server or S3).
3. The origin returns it, optionally with a **TTL** header saying how long to cache.
4. The CDN caches and returns it; it stays cached until the TTL expires.
5. A second user requests the same image → served straight from the edge (while the TTL holds).

Considerations:

- **Cost** — you pay per transfer; don't CDN rarely-used assets.
- **Cache expiry** — not too long (stale) nor too short (constant re-fetch from origin).
- **CDN fallback** — clients should detect a CDN outage and fetch from origin.
- **Invalidation** — remove a file early via the vendor's API, or **version** the URL (e.g. \`image.png?v=2\`).

Now static assets come from the CDN (not web servers) and the DB load is lightened by the cache.

## Stateless web tier

To scale the web tier horizontally, move **state** (e.g. user session data) out of it.

- **Stateful server** — remembers a client's data between requests. If user A's session lives on server 1, every one of A's requests must be pinned to server 1 (**sticky sessions**). That adds overhead and makes adding/removing servers and handling failures painful.
- **Stateless server** — keeps no session state; any request can hit any server, which pulls state from a **shared data store**.

Store session data in a shared store (RDBMS, Memcached/Redis, or NoSQL — NoSQL scales easily). With state out of the web servers, **auto-scaling** (adding/removing servers by load) becomes trivial. A stateless system is simpler, more robust, and scalable.

## Data centers

Serve users worldwide from **multiple data centers**. In normal operation users are **geoDNS-routed** to the nearest one (e.g. x% US-East, the rest US-West). On a data-center outage, route 100% of traffic to a healthy one.

Challenges:

- **Traffic redirection** — GeoDNS steers users to the nearest data center.
- **Data synchronization** — replicate data across data centers, or failover traffic may land where the data isn't. (Netflix uses async multi-data-center replication.)
- **Test & deployment** — test at different locations; automated deploys keep every data center consistent.

## Message queue

A durable, in-memory component enabling **asynchronous** communication and acting as a buffer. **Producers/publishers** post messages; **consumers/subscribers** read and act on them.

Decoupling is the win: the producer can post while the consumer is down, and the consumer can drain the queue while the producer is down. Producer and consumer **scale independently** — e.g. web servers publish photo-processing jobs; a pool of workers consumes them, and you add workers when the queue grows, remove them when it's empty.

## Logging, metrics, automation

Optional on a few servers; essential at scale.

- **Logging** — watch error logs; aggregate them to a central service for search.
- **Metrics** — host-level (CPU, memory, disk I/O), aggregated (DB/cache tier performance), and business (DAU, retention, revenue).
- **Automation** — CI verifies every check-in; automated build/test/deploy boosts productivity.

## Database scaling

**Vertical** — add CPU/RAM/disk to the DB box (RDS offers servers with 24 TB RAM; Stack Overflow ran on one master in 2013). Drawbacks: hardware limits, greater SPOF risk, high cost.

**Horizontal (sharding)** — split one big database into smaller **shards** that share a schema but hold distinct data. A **hash function** on the **sharding key** picks the shard — e.g. \`user_id % 4\` maps each user to shard 0–3.

Choosing the sharding (partition) key well is the most important decision — pick one that **distributes data evenly**. Sharding's challenges:

- **Resharding data** — needed when a shard outgrows its capacity or fills unevenly; requires updating the hash and moving data. **Consistent hashing** is the usual fix.
- **Celebrity (hotspot) problem** — excessive reads on one shard (Katy Perry + Bieber + Gaga all landing together) overload it; may need a dedicated shard per celebrity.
- **Joins & de-normalization** — cross-shard joins are hard; **de-normalize** so queries hit a single table.

Some non-relational functionality can move to a NoSQL store to shed DB load.

## Millions of users and beyond

Scaling is iterative. To support millions:

- Keep the **web tier stateless**.
- Build **redundancy** at every tier.
- **Cache** data as much as you can.
- Support **multiple data centers**.
- Host **static assets in a CDN**.
- Scale the **data tier by sharding**.
- Split tiers into **individual services**.
- **Monitor** with automation tools.

## Reference materials

- Hypertext Transfer Protocol — en.wikipedia.org/wiki/Hypertext_Transfer_Protocol
- Should you go Beyond Relational Databases? — blog.teamtreehouse.com
- Replication (computing) — en.wikipedia.org/wiki/Replication_(computing)
- Multi-master replication — en.wikipedia.org/wiki/Multi-master_replication
- Scaling Memcache at Facebook (NSDI '13) — usenix.org
- What it takes to run Stack Overflow — nickcraver.com
- Active-Active for Multi-Regional Resiliency (Netflix) — netflixtechblog.com`;
