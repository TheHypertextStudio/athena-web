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
`withCspMeta` parses the original provider document inertly with exact-pinned `parse5@8.0.1`,
inserts a host-created policy node as the normalized head's first child, and serializes the same
document with its doctype intact. This is security-critical: HTML accepts executable markup before
a late `<head>`, and string insertion into that head lets Chromium run the earlier node before it
sees the policy. Preserving the original doctype also keeps ordinary provider documents in
standards mode instead of silently changing their CSS layout to quirks mode. Permissions declared
under `_meta.ui.permissions` become an `allow` attribute in Permission Policy form
(`camera 'src'`), granting the feature to the frame's own origin only.

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

The browser bridge is keyed by a stable presentation instance that includes its originating
connection. A persisted conversation card uses `connectionId:activityId`; the manual launcher uses
its connection id. Replacing one connection with another therefore tears down and recreates the
frame even when both servers expose the same tool and `ui://` URI. Each bridge retains its own
connection callback during bounded teardown, while ordinary rerenders of the same instance update
their callback in place without reinitializing the app.

---

## 6. Theming and sizing

### The vocabulary is the contract

The extension standardizes a closed set of custom-property names (`McpUiStyleVariableKey`). A
widget that asks for a name outside that set does not fail — it renders wrong, in someone else's
product, and the first report is a screenshot. Docket shipped exactly that: the widget stylesheet
asked for `--color-surface-primary`, `--color-accent-primary`, `--color-danger-primary`, and
`--font-family-sans`, none of which any host supplies.

`apps/api/tests/mcp/mcp-apps-tokens.test.ts` now parses the union out of `specs/vendor/` and fails
if a widget declares a name outside it. `STYLE_VARIABLE_MAP` in `mcp-app-view.tsx` is the other
half: Docket's MD3 token → the spec name, and every key in it is a union member.

### Fallbacks are literals, never self-references

The stylesheet's `:root` declarations are literal `light-dark()` pairs. They must never be written
`--x: var(--x, fallback)`: a custom property that references itself is a dependency cycle, and CSS
resolves cycles to guaranteed-invalid _before_ substituting the fallback. That spelling reads like
a default and behaves like a deletion — it is what removed the card background and left the font on
browser-default serif. A host-supplied value arrives as an inline style on the root element and
outranks the stylesheet anyway, so nothing is gained by the indirection.

Both halves of every fallback clear AA against the surface they sit on, because the spec explicitly
permits a host to supply some colours and not others. `color-scheme` picks the half, and the view
pins it from `hostContext.theme` — which is also what decides how native form controls render
inside the frame.

Fonts are the one thing that cannot cross: the widget frame runs in an opaque origin under
`font-src 'self'`, so the app's IBM Plex `@font-face` is unreachable. The host sends the _resolved_
`font-family` stack (read off `document.body`, not the root — `next/font` declares its family
variable further down the tree, and reading the token at the root yields the literal text
`var(--font-ibm-plex-sans), …`, which takes the whole declaration down with it). The widget lands
on the same system sans the app falls back to.

### Sizing is a loop, and both ends must run

Docket advertises **flexible** `containerDimensions` — `maxHeight`, plus `maxWidth` measured from
the frame's container and re-sent on container resize. Under flexible dimensions the spec requires
the host to size the frame from `ui/notifications/size-changed`, so a widget that never measures
itself gets whatever height the host guessed. `watchSize` in `runtime.ts` reports on every layout
change through a `ResizeObserver` for the life of the document; the frame follows it, capped, so a
card never sits in a fixed box with its own scrollbar and a runaway widget cannot take over the
transcript.

A colour-scheme flip sends a **partial** `ui/notifications/host-context-changed`. The view merges
rather than replaces, and treats an absent key as unchanged rather than as a reset; the frame is
never re-pointed, so nothing the user did inside the widget is lost.

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

## 9. Stable conformance and interoperability evidence

- `packages/integrations/tests/mcp/mcp-apps-conformance.test.ts` — the stable gate: committed spec
  digests, all 81 uppercase RFC 2119 occurrences, host/sandbox/server/view responsibility,
  applicability, implementation evidence, real named tests, generated-document freshness, and an
  end-to-end test for every advertised optional capability.
- `packages/integrations/tests/mcp/mcp-apps-official-compat.test.ts` — the official SDK `App`
  drives Athena's real compatibility facade and proxy transport through handshake ordering,
  truthful capabilities, malformed input, tool input/result, a view-initiated tool call, links,
  text messages, size/theme changes, fullscreen negotiation, and graceful teardown.
- `packages/integrations/tests/mcp/mcp-apps-host.test.ts` — protocol behavior and security policy
  driven without a browser.
- `packages/integrations/tests/mcp/mcp-apps-sandbox.test.ts` — executes the shipped proxy script
  against stand-ins for its browser objects.
- `apps/web/tests/athena/mcp-app-view.test.tsx` — browser-adapter lifecycle, failure disposal,
  same-instance rerender stability, cross-connection replacement and routing, host context, focus,
  and graceful teardown.
- `apps/web/e2e/athena/mcp-apps-stable.spec.ts` — real Chromium evidence for hostile-order CSP and
  the complete Athena model-invocation journey: automatic inline render, original-connection app
  calls, text fallback, reload without rerun, theme, sizing, fullscreen, focus, and teardown. The
  journey is runnable and unskipped; the current worktree dev stack cannot complete its real auth
  ceremony because the Web-to-API auth rewrite hangs, so only its standalone hostile-CSP test is
  closed locally in this pass.
- `apps/api/tests/mcp/mcp-apps-sandbox.test.ts` — the proxy endpoint's headers and origin.
- `apps/api/tests/mcp/mcp-apps-tokens.test.ts` — the widget stylesheet's vocabulary, against the
  vendored spec.
- `apps/web/e2e/mcp/widget-shots.spec.ts` — every widget, every state, at 720px and 320px, in light
  and dark, with and without a host palette. Drives the real handshake against a fake host and
  writes to `docs/design/audits/screenshots/mcp-apps/`, which is where the craft review reads from.
  The suite asserts each widget reports its own height and that nothing overflows horizontally, so
  a broken resize loop hangs the spec rather than passing it.

### Pinned upstream map-server smoke

The workspace exact-pins `@modelcontextprotocol/server-map@1.7.5`. Its published Streamable HTTP
example binds `localhost`/`0.0.0.0`; Athena correctly rejects that address before connecting, so a
local process cannot be used to manufacture remote interoperability evidence by weakening SSRF.

Run the pinned server, expose its `/mcp` route through an ephemeral **public HTTPS** endpoint, then
exercise the production `RealMcpConnector`:

```bash
# Terminal 1. This local origin is only the tunnel/deployment source; Athena will not call it.
PORT=3001 pnpm --filter @docket/integrations exec mcp-map-server

# Terminal 2. Point at the public HTTPS endpoint created for the process above.
MCP_MAP_INTEROP_URL=https://PUBLIC-EPHEMERAL-HOST.example/mcp \
  pnpm --filter @docket/integrations test:mcp-map-interop
```

The command calls `geocode` for Las Vegas, validates and parses the first returned bounding box,
passes those exact server-derived bounds to `show-map`, and then fails unless `show-map` returns
meaningful text and Athena retains its `ui://cesium-map/mcp-app.html` presentation. An authenticated
production acceptance run still requires a real Athena account connected to that public endpoint;
this manual transport smoke does not close that release gate.
