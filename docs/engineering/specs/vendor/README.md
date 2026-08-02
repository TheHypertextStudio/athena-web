# Vendored upstream specifications

Verbatim, unmodified copies of external specifications that Docket implements. They are committed
so conformance tests can assert against **the text as published**, not against what an
implementer remembered. Nothing here is edited: if a copy drifts from upstream, replace the whole
file and update `sources.json`.

`sources.json` records, per file, the retrieval URL, the retrieval date, the version identifier as
published by that source, and the SHA-256 of the bytes in this directory. The conformance suites
(`packages/integrations/tests/mcp/`, `apps/api/tests/mcp/`) read these files at test time and derive
every method name, capability key, and field name they assert from them.

| File                                 | Upstream                         | Version               |
| ------------------------------------ | -------------------------------- | --------------------- |
| `mcp-apps-2026-01-26.mdx`            | `modelcontextprotocol/ext-apps`  | `2026-01-26` (Stable) |
| `mcp-apps-2026-01-26.spec.types.txt` | `modelcontextprotocol/ext-apps`  | `2026-01-26` (Stable) |
| `mcp-tasks-draft.md`                 | `modelcontextprotocol/ext-tasks` | `draft`               |
| `mcp-tasks-draft.schema.txt`         | `modelcontextprotocol/ext-tasks` | `draft`               |

The two `.txt` files are TypeScript sources upstream. They carry a `.txt` extension here so this
repo's own typecheck, lint, and coverage tooling treats them as the data they are rather than as
Docket source that must satisfy Docket's conventions.

To refresh, re-download each `url` in `sources.json`, overwrite the file, and regenerate the
digests:

```
pnpm --filter @docket/integrations exec tsx tests/mcp/emit-spec-digests.ts
```
