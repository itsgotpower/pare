# Releasing Pare

How versions are numbered and how a release is cut. Pare follows
[Semantic Versioning 2.0.0](https://semver.org). The version lives in **one**
place — `package.json` `version` — and everything else derives from it.

## The version is single-sourced

```
package.json  "version"            ← the source of truth; bump this
  ├─ next.config.ts                → NEXT_PUBLIC_APP_VERSION (client bundle)
  │     └─ app/page.tsx, app/profile/page.tsx, components/layout/navbar.tsx
  │          → "v{version}" linking to /releases/tag/v{version}
  └─ mcp/server.ts                 → McpServer({ version: pkg.version })
```

Never hardcode a version string anywhere else. The in-app badge links to
`https://github.com/itsgotpower/pare/releases/tag/v{version}`, so **a tag and a
GitHub release must exist for the version you ship** or that link 404s.

## Which number to bump

`MAJOR.MINOR.PATCH`. Pare is currently **below 1.0.0**, and the rules differ
before and after that line.

### While we are on `0.x` (now)

Per SemVer §4, anything may change in `0.x`; the public surface is not yet
promised to be stable. In practice:

| Change | Bump | Example |
| --- | --- | --- |
| Bug fix, backwards-compatible tweak | **PATCH** → `0.1.0` → `0.1.1` | Fix a parser crash, correct a balance calc, patch a vuln without changing behavior |
| New feature **or** a breaking change | **MINOR** → `0.1.0` → `0.2.0` | Add a dashboard tab / MCP tool / statement format; **also** remove a route or change the crypto/DB format |

The key pre-1.0 rule: **breaking changes ride the minor slot, not a major
bump.** Do not go to `2.0.0` because something broke while we're on `0.x`.

### Once we reach `1.0.0`

`1.0.0` is a deliberate statement — "the public API is stable and I'll keep it
compatible" — not an automatic side effect of any change. Cut it when the public
surface (HTTP routes, MCP tool contracts, the encrypted-DB envelope and on-disk
formats) is something we're willing to support across versions, and there are
real users depending on it. After that:

| Bump | When |
| --- | --- |
| **PATCH** `1.0.0` → `1.0.1` | Backwards-compatible bug fixes only |
| **MINOR** `1.0.0` → `1.1.0` | New, backwards-compatible functionality (incl. deprecations) |
| **MAJOR** `1.0.0` → `2.0.0` | Any breaking change — removed/renamed route, incompatible crypto or schema change, dropped config flag |

Mental model: **MAJOR = "you must change something," MINOR = "you can use
something new," PATCH = "same behavior, less broken."**

### What counts as "breaking" for Pare

- Removing or renaming an HTTP route or changing its request/response shape.
- Changing an MCP tool's name, arguments, or output contract.
- A change to the whole-DB crypto envelope or on-disk DB format that an existing
  database can't be read by / migrated forward.
- Removing or renaming an env var or config flag that self-hosters set.

A change that's gated behind a forward migration (old data still loads) is
**not** breaking.

## Cutting a release

1. **Decide the number** using the table above. Group the merged-since-last-tag
   commits by their Conventional Commit prefix — any `feat:` → at least a minor;
   a breaking change → minor (pre-1.0) or major (post-1.0); only `fix:`/`chore:`
   → patch.
2. **Update [`CHANGELOG.md`](../CHANGELOG.md)**: rename the `[Unreleased]`
   section to the new version with today's date, add a fresh empty
   `[Unreleased]`, and update the compare links at the bottom.
3. **Bump `package.json`** `version` (this is the only file to edit for the
   version itself):
   ```bash
   npm version <patch|minor|major> --no-git-tag-version
   ```
   `--no-git-tag-version` just edits `package.json` (and the lockfile) so you can
   commit it alongside the changelog. Drop the flag if you want npm to commit and
   tag in one step.
4. **Verify** the version propagated and the build is green:
   ```bash
   grep '"version"' package.json
   npm run typecheck:workers && npm run cf:build
   ```
5. **Commit** the bump + changelog:
   ```bash
   git commit -s -m "chore(release): v$(node -p "require('./package.json').version")"
   ```
6. **Tag** with a `v` prefix (matches the in-app release link) and push:
   ```bash
   V=v$(node -p "require('./package.json').version")
   git tag -a "$V" -m "$V"
   git push origin main "$V"
   ```
7. **Create the GitHub release** for that tag, pasting the changelog section as
   the notes — this is what the in-app "v{version}" badge links to:
   ```bash
   gh release create "$V" --title "$V" --notes-file <(sed -n '/^## \['"${V#v}"'\]/,/^## \[/p' CHANGELOG.md)
   ```
   (Or create it in the GitHub UI and paste the notes by hand.)

## Conventions

- Git tags are **`v`-prefixed** (`v0.2.0`); the `package.json` value is **not**
  (`0.2.0`). The UI adds the `v`.
- Commits/PRs use [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `chore:`, `copy:`) — this is what makes the bump
  decision fall out of `git log`.
- The changelog is for humans: list user- and integrator-facing changes. Pure
  internal churn (formatting, refactors with no behavior change) can be omitted.
