// CS Fundamentals · Tooling — "npm peer dependencies & --legacy-peer-deps". Why
// ERESOLVE happens, what --legacy-peer-deps and --force actually do, and the
// cleaner fixes (overrides, version bumps). Rendered in the app's Markdown
// dialect; backticks are escaped (\`) because the whole guide is a template literal.
export const CSF_NPM_PEERDEPS_GUIDE = `# npm peer dependencies & \`--legacy-peer-deps\`

Everyone eventually hits it: \`npm install\` explodes with a wall of red \`ERESOLVE unable to resolve dependency tree\`, and Stack Overflow says "just add \`--legacy-peer-deps\`." This guide is what that flag actually does, why the error exists in the first place, and why the flag is a *silence-the-alarm* move, not a fix. Skim in ~12 minutes; the *Gotchas* are what turns a green install into a runtime crash.

## 1. What a peer dependency is

A normal \`dependency\` is something a package needs and installs for itself. A **\`peerDependency\`** is something a package needs but expects **the host app (or another plugin) to provide** — a shared singleton it must not duplicate.

The classic example: a React component library.

\`\`\`json
// a-react-datepicker/package.json
{
  "peerDependencies": { "react": "^18.0.0" }
}
\`\`\`

The datepicker uses React, but it must use **your** React — the one instance that owns the component tree. If it bundled its own copy, you'd have two Reacts, hooks would break, and \`instanceof\` checks would fail. So it declares React as a *peer*: "I need React 18, but *you* bring it." Plugins (ESLint plugins, Babel presets, webpack loaders) work the same way — they peer-depend on the host tool.

## 2. Why the error exists — a history

- **npm v3–v6:** peer dependencies were **not installed automatically** and conflicts were only a **warning**. You'd see \`npm WARN peerDependency\` and the install would succeed regardless. Convenient, but it let genuinely incompatible trees install and fail mysteriously at runtime.
- **npm v7+ (2020, ships with Node 15+):** peers are now **auto-installed** and the resolver **enforces** them. If your tree asks for two incompatible versions of a peer, npm **refuses to install** and throws \`ERESOLVE\` instead of quietly building a broken tree.

So the error isn't new breakage — it's npm surfacing a conflict that older npm swept under the rug.

## 3. Reading an ERESOLVE error

\`\`\`
npm ERR! ERESOLVE unable to resolve dependency tree
npm ERR!
npm ERR! While resolving: my-app@1.0.0
npm ERR! Found: react@17.0.2
npm ERR!   node_modules/react
npm ERR!     react@"17.0.2" from the root project
npm ERR!
npm ERR! Could not resolve dependency:
npm ERR! peer react@"^18.0.0" from a-react-datepicker@3.0.0
npm ERR!   node_modules/a-react-datepicker
\`\`\`

Read it as: *the root has React 17; the datepicker's peer wants React 18; those don't overlap, so npm can't pick one React.* The real conflict is a **version mismatch** — the datepicker is newer than your React.

## 4. What \`--legacy-peer-deps\` actually does

\`npm install --legacy-peer-deps\` tells npm to **ignore peerDependencies entirely during resolution** — i.e. behave like **npm v4-v6**: don't auto-install peers, don't fail on peer conflicts, just build the tree from regular deps and move on.

- It does **not** fix the mismatch. React stays at 17; the datepicker still *wants* 18. npm simply stops checking.
- The install goes green. Whether the code *works* is now your problem — it depends on whether the datepicker actually needs React 18 APIs at runtime.
- It's a **resolution-time** flag only; it changes nothing about what's on disk beyond skipping the peer install/check.

Persist it for a project via \`.npmrc\`:
\`\`\`
legacy-peer-deps=true
\`\`\`

## 5. \`--legacy-peer-deps\` vs \`--force\`

Both let a conflicted install proceed, but they're not the same:

| | \`--legacy-peer-deps\` | \`--force\` |
|---|---|---|
| Peer conflicts | **ignored** (skips peer logic) | overridden — installs anyway |
| Scope | *only* peer-dependency resolution | broad: also bypasses cache, overwrites, other guards |
| Tree it builds | like npm v6 (no peers auto-installed) | keeps npm v7 resolution but forces past the conflict |
| Blast radius | narrower, more predictable | wider — can mask unrelated problems |

**Rule of thumb:** if you must silence a peer conflict, prefer \`--legacy-peer-deps\` — it's the narrower, more predictable hammer. \`--force\` is a bigger override that can hide problems that have nothing to do with peers.

## 6. The cleaner fixes (reach for these first)

1. **Upgrade the thing that's behind.** The mismatch usually means one package is stale. Bump your React (or the plugin) so the ranges actually overlap. This is the real fix.
2. **\`overrides\` in \`package.json\`** (npm v8.3+) — force a single resolved version across the whole tree, deliberately and *in writing*:
\`\`\`json
{
  "overrides": {
    "react": "18.2.0"
  }
}
\`\`\`
   Unlike \`--legacy-peer-deps\`, this is committed, reviewable, and applies to everyone — a documented decision, not a hidden CLI flag. (Yarn's equivalent is \`resolutions\`.)
3. **Check whether the peer range is just over-strict.** Maintainers sometimes pin peers too tightly (\`^18.0.0\` when \`17\` would work). File an issue / PR to widen it, or use \`overrides\` to relax it knowingly.
4. **Wait for / pick a compatible version.** If a library truly needs React 18 and you're on 17, the honest answer is to upgrade React or not use that version of the library.

## 7. Gotchas — the checklist

- **Green install ≠ working app.** \`--legacy-peer-deps\` makes \`npm install\` succeed; it says nothing about whether the mismatched package works at runtime. If the plugin actually calls React-18-only APIs on your React 17, you get a crash *later*, far from the install.
- **Duplicate singletons.** Skipping peer resolution can leave two copies of a "must be single" package (React, \`@apollo/client\`, \`styled-components\`) in the tree → "Invalid hook call", broken context, \`instanceof\` failures. Peers exist *specifically* to prevent this.
- **CI drift.** Setting \`legacy-peer-deps=true\` in \`.npmrc\` makes it permanent and invisible — new contributors never see the conflict, and it hides the next real incompatibility too. Prefer a scoped \`overrides\` you can see in the diff.
- **\`--force\` for a peer problem.** Overkill; it also bypasses unrelated guards and can mask a genuinely broken install. Use \`--legacy-peer-deps\` if you must, \`overrides\` if you can.
- **\`npm ci\` respects it too** — but only via \`.npmrc\` / config, since \`npm ci\` is meant to be flagless and reproducible; a one-off CLI flag won't be there in CI unless you configure it.
- **Treating the flag as the fix and moving on.** It's a *snooze button*. Leave a comment or an issue so someone actually resolves the version mismatch, or it rots into a landmine at the next upgrade.

## 8. The one-paragraph version

"\`ERESOLVE\` means npm v7+ found two incompatible versions of a peer dependency — usually a plugin that wants a newer host (e.g. React 18) than the app has (React 17) — and refuses to build a broken tree. \`--legacy-peer-deps\` tells npm to behave like v6: ignore peers, install anyway. It silences the error but doesn't fix the mismatch, so a mismatched package can still crash at runtime, and you risk duplicate singletons. The real fixes are to bump the stale package, or pin a version deliberately with \`overrides\` in \`package.json\` — a committed, reviewable decision rather than a hidden flag. \`--force\` is a broader, blunter override; prefer \`--legacy-peer-deps\` when you truly must push past a peer conflict."
`;
