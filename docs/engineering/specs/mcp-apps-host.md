# MCP Apps host — implementation spec (area: `mcp-surface`)

Docket implements **both halves** of the MCP Apps extension (`io.modelcontextprotocol/ui`,
SEP-1865, version `2026-01-26`):

- **Producer** — Docket's own tools declare `ui://docket/*` widgets so a host like Claude can
  render a change report, a work list, an entity, or a day plan. This half already shipped; see
  `apps/api/src/mcp/apps/`.
- **Host** — a widget returned by a **connected third-party** MCP server renders live, sandboxed
  and interactive, inside the Athena conversation. This document covers that half.

The published specification is committed verbatim at
`docs/engineering/specs/vendor/mcp-apps-2026-01-26.mdx` with its retrieval date, source URL, and
SHA-256 in `sources.json`. Every method name, capability key, and `_meta` key in the
implementation is asserted against that copy by
`packages/integrations/tests/mcp/mcp-apps-conformance.test.ts`, and the resulting
[conformance matrix](mcp-apps-conformance.md) is regenerated from it.

---

## 1. Where each piece lives

| Concern                                                         | Module                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Protocol constants and types (one spelling, both sides)         | `packages/types/src/mcp-apps.ts`                                    |
| The host bridge — JSON-RPC over `postMessage`, framework-free   | `packages/integrations/src/mcp-apps-host.ts`                        |
| The sandbox proxy document + CSP injection                      | `packages/integrations/src/mcp-apps-sandbox.ts`                     |
| The proxy endpoint, served from the API origin                  | `apps/api/src/mcp/apps/sandbox.ts` → `GET /mcp/apps/sandbox`        |
| Server-side widget listing, rendering, and view-initiated calls | `apps/api/src/mcp/apps/host-routes.ts` → `/v1/me/athena/mcp-apps/*` |
| Client capability declaration on outbound connections           | `packages/integrations/src/mcp-connector.ts`                        |
| The browser adapter (frames, theme, height)                     | `apps/web/src/components/athena/mcp-app-view.tsx`                   |
| The Athena surface (connect + choose + render)                  | `apps/web/src/components/athena/athena-mcp-panel.tsx`               |

The bridge touches no DOM and no React on purpose: the whole protocol is driven by a fake view
frame in `packages/integrations/tests/mcp/mcp-apps-host.test.ts`, so ordering, refusals, and CSP
construction are unit-testable rather than only observable in a browser.

---

## 2. The two frames, and why there are two

```
docket.<apex>                       api.docket.<apex>                (opaque origin)
┌───────────────────┐  postMessage  ┌────────────────────┐ postMessage ┌──────────────┐
│ Athena (host)     │◀─────────────▶│ sandbox proxy      │◀───────────▶│ widget view  │
│ McpAppView        │               │ allow-scripts      │             │ allow-scripts│
│ createMcpAppHost  │               │ allow-same-origin  │             │ srcdoc + CSP │
└───────────────────┘               └────────────────────┘             └──────────────┘
```

The spec requires a **web** host to wrap untrusted widget HTML in a proxy on a different origin.
Docket already has one, so the proxy is served from the API host. It holds nothing — no session,
no storage, no API surface — and its own CSP (`connect-src 'none'`) means a full compromise of the
proxy origin still cannot become an exfiltration channel.

Only the proxy gets `allow-same-origin`, and only so it can set the inner frame's policy. **The
widget never gets an origin**: its sandbox is exactly `allow-scripts` — no `allow-same-origin`, no
`allow-top-navigation`, no `allow-forms`, no `allow-popups`. Its one route out is `postMessage`,
which is precisely what makes the spec's auditability argument hold.

The proxy never originates a message. It forwards, in both directions, everything whose method
does not begin `ui/notifications/sandbox-`, and it accepts one document — a second
`sandbox-resource-ready` is ignored, so a compromised host tab cannot swap the widget a user is
looking at.

---

## 3. Content Security Policy

Built by `buildViewCsp` from the resource's own `_meta.ui.csp`, starting from `default-src 'none'`
and adding **only** what the resource declared. A resource that declares nothing gets:

```
default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; media-src 'self' data:; connect-src 'none';
frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none';
```

`connect-src` gets **no implicit `'self'`**. The spec's own construction snippet includes one; a
widget in an opaque origin has no same-origin server to reach, so `'self'` there would buy nothing
and is the single directive that could let a widget exfiltrate what it was shown. That is the one
deliberate deviation from the spec's example, and it is strictly more restrictive.

The policy travels as a `<meta http-equiv>` prepended to the document (a `srcdoc` frame has no
response headers) and is computed **host-side** — never by a script running on the sandbox origin.
Permissions declared under `_meta.ui.permissions` become an `allow` attribute in Permission Policy
form (`camera 'src'`), granting the feature to the frame's own origin only.

---

## 4. Ordering guarantees

The spec forbids the host sending anything to the view before `ui/notifications/initialized`
arrives, and requires `ui/notifications/tool-input` before `ui/notifications/tool-result`. Both are
enforced by a queue inside `createMcpAppHost`, not by callers being careful — a caller **cannot**
get the order wrong. The `ui/initialize` response itself is exempt, because the view is blocked on
it.

If a caller delivers a result without ever supplying arguments, an empty `tool-input` is
synthesized first, because a view is entitled to rely on the ordering and a missing notification
would strand one that waits for it.

---

## 5. Authorization for widget-initiated `tools/call`

A widget's `tools/call` goes: view → proxy → host bridge → `POST /v1/me/athena/mcp-apps/view-call`
→ the connected server. Three checks, in this order:

1. **Ownership.** The connection must be `connected` and owned by the authenticated user. A miss
   is a 404, not a 403, so another user's connection id cannot be confirmed by probing.
2. **Advertised.** The tool must appear in that server's own `tools/list`. A widget cannot reach a
   tool its server does not offer, and cannot reach a tool on a _different_ connection at all —
   the connection id comes from the render that produced the widget, not from the widget.
3. **View-callable.** The spec's `visibility` rule: a tool whose `_meta.ui.visibility` excludes
   `"app"` is model-callable but not view-callable. Absent visibility means both.

Every refusal is an explicit JSON-RPC error naming the tool. A widget must be able to tell
"refused" from "did nothing", and the audit log must record which tool was asked for. The remote
server's own error text is never relayed — it is someone else's prose, possibly a stack trace, and
possibly attacker-authored.

The browser holds **no credential** for a connected server. That is the reason for the API routes
rather than a generic proxy: the authorization decision must not live in the least trustworthy
place in the system.

---

## 6. Theming and sizing

The host maps Docket's MD3 tokens onto the spec's standardized `--color-*` / `--font-*` vocabulary
(`hostStyleVariables`), reading them from the live computed style so a widget tracks the real
palette in both themes and after any future token change. A colour-scheme flip sends a **partial**
`ui/notifications/host-context-changed`; the frame is never re-pointed, so nothing the user did
inside the widget is lost. A widget reports its own size with
`ui/notifications/size-changed` and the frame follows it, capped, so a card never sits in a fixed
box with its own scrollbar and a runaway widget cannot take over the transcript.

---

## 7. Connecting from Athena

Connecting a server and using what it gave you are one activity, so both live on the Athena
surface (`AthenaMcpPanel`). The connect form is a dialog **over** the conversation: the route does
not change, the conversation stays visible behind it, and the tools a new server brings appear in
the same panel as soon as it connects. Connections are personal (`/v1/me/athena/connections`) —
the same rows the Settings surface manages, so a connection made in either place is one connection.

---

## 8. Deliberate deviations, and why

| Spec text                                               | Docket                                                                | Reason                                                                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSP example includes `connect-src 'self'`               | omitted                                                               | A view has no same-origin server; `'self'` would only widen exfiltration surface.                                                                                           |
| `_meta.ui` is the tool→widget key                       | Docket emits `_meta.ui` **and** `_meta["io.modelcontextprotocol/ui"]` | Hosts written against pre-stable drafts read the extension id. `_meta` is an open map; carrying both renders in either generation. Readers prefer `_meta.ui`.               |
| `_meta.ui.domain` is a per-resource sandbox origin      | Docket serves every view from its own API-origin proxy                | The field is explicitly host-dependent. A per-resource subdomain would need wildcard DNS and certificates for a property nothing yet depends on.                            |
| Host capabilities include `experimental` and `sampling` | representable, not advertised                                         | Docket exposes no experimental host features, and does not let embedded third-party HTML drive model sampling. Advertising either would promise a channel the host refuses. |

---

## 9. Evidence

- `packages/integrations/tests/mcp/mcp-apps-host.test.ts` — 50 tests driving a fake view frame.
- `packages/integrations/tests/mcp/mcp-apps-sandbox.test.ts` — 14 tests that **execute** the
  shipped proxy script against a stand-in for its three browser objects.
- `packages/integrations/tests/mcp/mcp-apps-conformance.test.ts` — the gate: spec digests, full
  surface coverage, and a check that every test the matrix cites exists by name.
- `apps/web/tests/athena/mcp-app-view.test.tsx` — 15 tests of the browser adapter.
- `apps/api/tests/mcp/mcp-apps-sandbox.test.ts` — the proxy endpoint's headers and origin.
- Live screenshots: `apps/web/.data/design-review/mcp-apps/`.
