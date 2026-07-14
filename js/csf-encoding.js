// CS Fundamentals — "Character Encoding" (charset, Unicode, UTF-8 and friends),
// a study guide in the app's Markdown dialect. Own module to keep the big string
// out of the seed logic. Backticks are escaped (\`) — it's a template literal.
export const CSF_ENCODING_GUIDE = `# Character Encoding — charset, Unicode & UTF-8

A computer only stores **bytes**; text is an interpretation laid over them. \`Content-Type: text/html; charset=utf-8\` is the server telling the client *which* interpretation to use. Get the mapping wrong and “café” arrives as “cafÃ©”. This is how the mapping works.

## The core split: character set vs. encoding

Two different jobs, often confused:

- **Character set (code points)** — the catalog of characters and the number assigned to each. In Unicode, \`A\` = U+0041, \`é\` = U+00E9, \`🙂\` = U+1F642. A **code point** is an abstract integer, not bytes.
- **Encoding** — the rule that turns those code points **into bytes** (and back). UTF-8, UTF-16, UTF-32 are three encodings of the *same* Unicode code points.

So: text → **code points** (character set) → **bytes** (encoding). \`charset=utf-8\` names the encoding used for the bytes you're receiving.

## A short history (why this is messy)

- **ASCII** — 7 bits, 128 code points: English letters, digits, punctuation, control chars. Simple, but no \`é\`, \`ñ\`, \`£\`, or \`あ\`.
- **Extended ASCII / code pages** — the 8th bit added 128 more, but everyone used it differently (Latin-1, Windows-1252, KOI8-R…). The same byte \`0xE9\` meant \`é\` in one code page and something else in another → **mojibake** when the reader guessed wrong.
- **Unicode** — one universal catalog for *every* script. Code points run **U+0000 to U+10FFFF** (~1.1M slots, organized into 17 “planes”; the first, the BMP, holds most common characters). Unicode fixes *which number* each character is — encodings decide *how to store* that number.

## The Unicode encodings

| Encoding | Bytes/char | ASCII-compatible? | Notes |
|---|---|---|---|
| **UTF-8** | 1–4 (variable) | **Yes** | Superset of ASCII; no endianness; compact for Latin text. The web default. |
| **UTF-16** | 2 or 4 | No | 2 bytes for the BMP, **surrogate pairs** (4 bytes) beyond it; has endianness (needs a BOM). Used in-memory by Java/JS/.NET. |
| **UTF-32** | 4 (fixed) | No | Trivial indexing (1 code point = 1 unit) but wastes space; rarely used on the wire. |

**Why UTF-8 won the web:** it's a strict superset of ASCII (an all-English file is byte-identical, so old ASCII tools still work), it has **no byte-order problem**, and it's compact for the Latin-heavy text that dominates.

## How UTF-8 actually encodes

The number of leading 1-bits in the first byte announces the length; every continuation byte starts \`10\`:

\`\`\`
Code point range     Byte 1     Byte 2    Byte 3    Byte 4
U+0000  – U+007F     0xxxxxxx                                (ASCII, 1 byte)
U+0080  – U+07FF     110xxxxx   10xxxxxx                     (2 bytes)
U+0800  – U+FFFF     1110xxxx   10xxxxxx  10xxxxxx           (3 bytes)
U+10000 – U+10FFFF   11110xxx   10xxxxxx  10xxxxxx  10xxxxxx (4 bytes)
\`\`\`

Example — \`é\` (U+00E9) → \`11000011 10101001\` = bytes \`0xC3 0xA9\`. That's why a UTF-8 \`é\` misread as Latin-1 shows as two characters, \`Ã©\` (0xC3=Ã, 0xA9=©) — the classic mojibake tell.

**Self-synchronizing:** because continuation bytes always start \`10\`, a decoder that lands mid-character can find the next boundary — a corrupted byte doesn't cascade through the whole stream.

## Where you meet the charset declaration

The receiver must know the encoding to decode bytes back into characters. It's declared in layers (most specific wins):

- **HTTP header:** \`Content-Type: text/html; charset=utf-8\`.
- **HTML meta:** \`<meta charset="utf-8">\`.
- **BOM** (Byte Order Mark) — an optional prefix (\`0xEF 0xBB 0xBF\` for UTF-8) some tools add to signal the encoding/endianness.

If none is given the client **guesses** (or falls back to a legacy default) — the usual root cause of garbled text. Rule of thumb: **UTF-8 everywhere**, declared explicitly, end to end (DB, connection, files, headers).

## Related “make bytes safe” encodings

These aren't character sets — they re-encode bytes to survive text-only channels:

- **Base64** — maps arbitrary **binary → 64 ASCII characters** (A–Z a–z 0–9 + /). ~**33% larger**, but survives email bodies, JSON, and \`data:\` URIs that can't carry raw bytes. It's *encoding for transport*, not encryption.
- **Percent / URL encoding** — reserved or non-ASCII characters in a URL become \`%\` + hex of their UTF-8 bytes (space → \`%20\`, \`é\` → \`%C3%A9\`).
- **HTML entities** — \`&amp;\`, \`&#233;\`, \`&#x1F642;\` — encode characters that are reserved in HTML or hard to type.

## Gotchas that bite in practice

- **Bytes ≠ code points ≠ what the user sees.** \`🙂\` is 1 grapheme, 1 code point, but **4 bytes** in UTF-8 (and 2 UTF-16 units). A flag emoji is one *glyph* built from **two** code points. So \`"🙂".length\` in JS is 2 (UTF-16 units) — string length rarely equals “characters”.
- **Combining marks & normalization.** \`é\` can be one code point (U+00E9) or two (\`e\` + a combining accent). They look identical but compare unequal — **normalize** (NFC) before comparing or hashing.
- **Truncating by bytes** can slice a multi-byte character in half and corrupt it — truncate on code-point/grapheme boundaries.

## Interview checklist

- Distinguish **character set (code points)** from **encoding (bytes)**.
- Why **UTF-8**: ASCII superset, no endianness, compact, self-synchronizing.
- Sketch UTF-8's variable length (1–4 bytes) and the \`10xxxxxx\` continuation rule.
- Explain **mojibake**: bytes decoded with the wrong charset (UTF-8 read as Latin-1 → \`Ã©\`).
- \`charset=utf-8\` lives in the **HTTP header / meta / BOM**; declare it everywhere.
- **Base64** = binary→text for transport (+33%), not encryption; **percent-encoding** for URLs.
- **length ≠ bytes ≠ graphemes** (emoji, surrogate pairs, combining marks); normalize before comparing.`;
