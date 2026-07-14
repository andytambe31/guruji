// CS Fundamentals — "TCP & TLS Handshakes", a thorough study guide rendered in
// the app's Markdown dialect. Kept in its own module so the large string stays
// out of the seed logic. Backticks are escaped (\`) — the guide is a template
// literal.
export const CSF_TCP_TLS_GUIDE = `# TCP & TLS Handshakes — a deep dive

Every HTTPS request rides on two handshakes stacked on top of each other: **TCP** builds a reliable pipe, then **TLS** makes that pipe private. Interviewers love this because it threads together networking, security, and latency. This walks both end to end, then puts them together.

## Why a handshake at all?

- **TCP** is a *reliable, ordered byte stream* over an unreliable network (IP just fires packets and hopes). Before sending data, both sides must agree on starting **sequence numbers** and confirm each other is reachable and willing. That agreement is the handshake.
- **TLS** turns an open, plaintext TCP connection into an *authenticated, encrypted* channel. The handshake proves the server's identity and lets both sides agree on a secret key **without an eavesdropper learning it**.

## Part 1 — The TCP 3-way handshake

Three segments open the connection. Say the client picks initial sequence number \`x\`, the server \`y\`:

1. **SYN** — client → server. "I want to talk; my sequence starts at \`x\`." (SYN flag set, seq = x.)
2. **SYN-ACK** — server → client. "Got it (ack = x+1); my sequence starts at \`y\`." (SYN + ACK flags, seq = y, ack = x+1.)
3. **ACK** — client → server. "Got yours too (ack = y+1)." Data can now flow.

\`\`\`
Client                         Server
  |  ---- SYN  seq=x --------->  |   (LISTEN)
  |  <-- SYN-ACK seq=y ack=x+1-  |
  |  ---- ACK  ack=y+1 ------->  |
  |        [ESTABLISHED]         |
\`\`\`

**Why three, not two?** Each side must prove *its own* sequence number was received. The client's SYN + the server's ACK proves one direction; the server's SYN + the client's ACK proves the other. Two messages can only synchronize one direction — you'd never confirm the server's starting sequence.

**What sequence numbers buy you:** they let the receiver reassemble bytes **in order** and detect loss (a missing seq → retransmit) and duplicates. Random ISNs also make it hard for an off-path attacker to inject data.

Key state + edge cases worth naming:

- **State machine:** the server goes \`LISTEN → SYN_RCVD → ESTABLISHED\`; the client \`SYN_SENT → ESTABLISHED\`.
- **Closing is a 4-way handshake:** each side sends its own \`FIN\` and \`ACK\`s the other's, because a TCP connection is **full-duplex** — each direction closes independently.
- **TIME_WAIT:** the side that closes first lingers (~2×MSL) so late packets don't leak into a new connection reusing the same ports.
- **SYN flood:** an attacker sends SYNs but never the final ACK, exhausting the half-open connection table. **SYN cookies** defend by not allocating state until the ACK arrives.
- **Connection reuse (keep-alive):** the handshake costs a full round trip, so HTTP keeps the TCP connection open and reuses it for many requests — the single biggest latency win, since it also skips the TLS handshake below.

## Part 2 — The TLS handshake

TLS runs **after** TCP is established. The modern flow is **TLS 1.3** (one round trip); TLS 1.2 took two. The steps:

1. **ClientHello** — the client announces supported **TLS versions** and **cipher suites**, sends a **key share** (its ECDHE public parameters), and includes the **SNI** (Server Name Indication) — the hostname it wants. SNI is what lets one IP address host many HTTPS sites, each with its own certificate.
2. **ServerHello** — the server picks the version + cipher, sends **its** ECDHE key share, and returns its **certificate chain** (leaf → intermediates, up toward a root CA).
3. **Certificate validation** — the browser checks the certificate:
   - **Hostname** matches the SNI / URL (Subject Alternative Name).
   - **Trust chain** links to a **root CA** in the OS/browser trust store.
   - **Validity period** — not expired, not yet-to-be-valid.
   - **Revocation** — not revoked (OCSP / CRL / OCSP stapling).
4. **Key exchange (ECDHE)** — both sides combine their own private value with the other's public share to derive the **same shared secret**, which never travels the wire. From it they derive the symmetric **session keys**.
5. **Finished** — each side sends a MAC over the whole handshake transcript, proving nothing was tampered with. The encrypted session is live.
6. **Application data** — all HTTP now rides **fast symmetric encryption** (an AEAD cipher like AES-GCM or ChaCha20-Poly1305).

\`\`\`
Client                              Server
  | -- ClientHello ---------------->  |   versions, ciphers, SNI, key share
  | <-- ServerHello ---------------  |   chosen params, cert chain, key share
  |     verify cert:                  |
  |       ✓ hostname                  |
  |       ✓ chain to a trusted CA     |
  |       ✓ not expired               |
  |       ✓ not revoked               |
  | -- (both derive shared secret) -- |   ECDHE — key never sent
  | -- Finished ------------------->  |
  | <-- Finished -------------------  |
  |   [encrypted application data]    |
\`\`\`

### Two ideas that come up every interview

- **Asymmetric to bootstrap, symmetric to run.** Public-key crypto (the cert + ECDHE) is slow, so it's used only to authenticate and agree on a key. The bulk data then uses fast symmetric encryption. Best of both.
- **Forward secrecy.** Because ECDHE generates a *fresh, ephemeral* key per session, recording today's traffic and stealing the server's long-term private key **later** still won't decrypt it. Old RSA key exchange lacked this — one leaked key exposed all past sessions.

### TLS 1.3 vs 1.2, and 0-RTT

| | TLS 1.2 | TLS 1.3 |
|---|---|---|
| Round trips | 2 | **1** |
| Key exchange | RSA or DHE/ECDHE | **ECDHE only** (forward secrecy always) |
| Cipher suites | many, some weak | small, modern (AEAD only) |
| Resumption | session IDs/tickets | tickets + **0-RTT** |

**0-RTT resumption** lets a returning client send application data on its *very first* message, saving a round trip — at the cost that this "early data" can be **replayed** by an attacker, so it must only carry idempotent requests.

## Part 3 — Putting it together

For a fresh HTTPS connection the round trips stack up:

- **1 RTT** for the TCP handshake, then
- **1 RTT** for the TLS 1.3 handshake, then
- **1 RTT** for the HTTP request/response.

That's why the levers are **connection reuse** (keep-alive amortizes both handshakes over many requests), **TLS session resumption / 0-RTT**, and **QUIC (HTTP/3)** — which runs over UDP and **folds the transport + TLS handshakes into one**, cutting a round trip and dodging TCP's head-of-line blocking.

## Interview checklist

- Draw the 3-way handshake and explain **why three** (confirm both sequence numbers).
- Sequence numbers → **ordering + reliability**; TIME_WAIT → don't cross-contaminate a reused port.
- TLS order: **ClientHello → cert validation → ECDHE → symmetric encryption**.
- Name the **four cert checks** (hostname, CA chain, expiry, revocation).
- Explain **forward secrecy** (ephemeral ECDHE) and **SNI** (one IP, many certs).
- **TLS 1.3 = 1-RTT**; **0-RTT** trades a round trip for replay risk.
- Latency levers: keep-alive, resumption, **QUIC/HTTP-3** merges the handshakes.`;
