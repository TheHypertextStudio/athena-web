<!-- GENERATED FILE. Regenerate with:
     pnpm --filter @docket/integrations exec tsx tests/mcp/emit-conformance-matrix.ts -->

# MCP Apps conformance matrix

**Extension:** `io.modelcontextprotocol/ui`  
**Version, as published by the source:** `2026-01-26`  
**Source:** https://apps.extensions.modelcontextprotocol.io/api/  
**Spec copy:** `docs/engineering/specs/vendor/mcp-apps-2026-01-26.mdx`  
**Retrieved:** 2026-08-02

Every row below is derived from the committed copy of the specification, not from memory.
A row exists only when the item is implemented **and** exercised by a named test — there is no
"partial" or "deferred" state to hide in, because an item with no implementation simply has no
row, and `mcp-apps-conformance.test.ts` fails when the extracted surface contains an item the
matrix does not cover.

## Requests

| Item | Host handler | Test |
| --- | --- | --- |
| `ui/download-file` | `packages/integrations/src/mcp-apps-host.ts :: handleDownloadFile` | `mcp-apps-host.test.ts :: downloads a file through the host and refuses when declined` |
| `ui/initialize` | `packages/integrations/src/mcp-apps-host.ts :: handleInitialize` | `mcp-apps-host.test.ts :: answers ui/initialize with host capabilities and hostContext` |
| `ui/message` | `packages/integrations/src/mcp-apps-host.ts :: handleMessage` | `mcp-apps-host.test.ts :: posts a ui/message into the conversation` |
| `ui/open-link` | `packages/integrations/src/mcp-apps-host.ts :: handleOpenLink` | `mcp-apps-host.test.ts :: opens a link and answers with an empty result` |
| `ui/request-display-mode` | `packages/integrations/src/mcp-apps-host.ts :: handleRequestDisplayMode` | `mcp-apps-host.test.ts :: reports the display mode actually applied, not the one requested` |
| `ui/resource-teardown` | `packages/integrations/src/mcp-apps-host.ts :: requestTeardown` | `mcp-apps-host.test.ts :: asks the view to tear down and waits for its answer` |
| `ui/update-model-context` | `packages/integrations/src/mcp-apps-host.ts :: handleUpdateModelContext` | `mcp-apps-host.test.ts :: overwrites, rather than accumulates, the model context` |
| `tools/call` | `packages/integrations/src/mcp-apps-host.ts :: handleCallTool`<br>_Out-of-scope tools receive a JSON-RPC error naming the tool, never a silent success._ | `mcp-apps-host.test.ts :: executes an authorized tool and returns the result with the matching id` |
| `resources/read` | `packages/integrations/src/mcp-apps-host.ts :: handleReadResource` | `mcp-apps-host.test.ts :: proxies resources/read and reports failures` |
| `ping` | `packages/integrations/src/mcp-apps-host.ts :: receive` | `mcp-apps-host.test.ts :: answers ping` |

## Notifications

| Item | Host handler | Test |
| --- | --- | --- |
| `ui/notifications/host-context-changed` | `packages/integrations/src/mcp-apps-host.ts :: updateHostContext` | `mcp-apps-host.test.ts :: restyles in place: a theme change is a partial host-context patch, not a reload` |
| `ui/notifications/initialized` | `packages/integrations/src/mcp-apps-host.ts :: receive` | `mcp-apps-host.test.ts :: posts nothing to the view before ui/notifications/initialized arrives` |
| `ui/notifications/request-teardown` | `packages/integrations/src/mcp-apps-host.ts :: receive` | `mcp-apps-host.test.ts :: reports size changes and teardown requests, and records log lines` |
| `ui/notifications/sandbox-proxy-ready` | `packages/integrations/src/mcp-apps-sandbox.ts :: sandboxProxyDocument` | `mcp-apps-sandbox.test.ts :: announces itself to the host as soon as it loads` |
| `ui/notifications/sandbox-resource-ready` | `packages/integrations/src/mcp-apps-sandbox.ts :: sandboxProxyDocument` | `mcp-apps-sandbox.test.ts :: renders the document it is handed under the policy it is handed` |
| `ui/notifications/size-changed` | `packages/integrations/src/mcp-apps-host.ts :: receive` | `mcp-apps-host.test.ts :: reports size changes and teardown requests, and records log lines` |
| `ui/notifications/tool-cancelled` | `packages/integrations/src/mcp-apps-host.ts :: deliverToolCancelled` | `mcp-apps-host.test.ts :: tells the view when the tool was cancelled` |
| `ui/notifications/tool-input` | `packages/integrations/src/mcp-apps-host.ts :: deliverToolInput` | `mcp-apps-host.test.ts :: carries the tool arguments on ui/notifications/tool-input` |
| `ui/notifications/tool-input-partial` | `packages/integrations/src/mcp-apps-host.ts :: deliverToolInputPartial` | `mcp-apps-host.test.ts :: stops streaming partial arguments once the complete set is sent` |
| `ui/notifications/tool-result` | `packages/integrations/src/mcp-apps-host.ts :: deliverToolResult` | `mcp-apps-host.test.ts :: never posts tool-result before tool-input, even when only the result is delivered` |
| `notifications/message` | `packages/integrations/src/mcp-apps-host.ts :: receive` | `mcp-apps-host.test.ts :: reports size changes and teardown requests, and records log lines` |

## Host capabilities

| Item | Host handler | Test |
| --- | --- | --- |
| `experimental` | `packages/types/src/mcp-apps.ts :: McpUiHostCapabilities`<br>_Declared in the type surface and omitted from the advertised set: Docket exposes no experimental host features, and advertising an empty bag would invite a view to probe it._ | `mcp-apps-conformance.test.ts :: every host capability the spec defines is representable` |
| `openLinks` | `packages/integrations/src/mcp-apps-host.ts :: hostCapabilities` | `mcp-apps-host.test.ts :: answers ui/initialize with host capabilities and hostContext` |
| `downloadFile` | `packages/integrations/src/mcp-apps-host.ts :: hostCapabilities` | `mcp-apps-host.test.ts :: downloads a file through the host and refuses when declined` |
| `serverTools` | `packages/integrations/src/mcp-apps-host.ts :: hostCapabilities` | `mcp-apps-host.test.ts :: answers ui/initialize with host capabilities and hostContext` |
| `serverResources` | `packages/integrations/src/mcp-apps-host.ts :: hostCapabilities` | `mcp-apps-host.test.ts :: proxies resources/read and reports failures` |
| `logging` | `packages/integrations/src/mcp-apps-host.ts :: hostCapabilities` | `mcp-apps-host.test.ts :: reports size changes and teardown requests, and records log lines` |
| `sandbox` | `packages/integrations/src/mcp-apps-host.ts :: hostCapabilities` | `mcp-apps-host.test.ts :: adds exactly the origins the resource declared and nothing else` |
| `updateModelContext` | `packages/integrations/src/mcp-apps-host.ts :: hostCapabilities` | `mcp-apps-host.test.ts :: overwrites, rather than accumulates, the model context` |
| `message` | `packages/integrations/src/mcp-apps-host.ts :: hostCapabilities` | `mcp-apps-host.test.ts :: posts a ui/message into the conversation` |
| `sampling` | `packages/types/src/mcp-apps.ts :: McpUiHostCapabilities`<br>_Representable and deliberately not advertised: Docket does not let embedded third-party HTML drive model sampling, and advertising it would promise a channel the host refuses._ | `mcp-apps-conformance.test.ts :: every host capability the spec defines is representable` |

## App capabilities

| Item | Host handler | Test |
| --- | --- | --- |
| `experimental` | `packages/integrations/src/mcp-apps-host.ts :: handleInitialize` | `mcp-apps-conformance.test.ts :: every app capability the spec defines survives the handshake` |
| `tools` | `packages/integrations/src/mcp-apps-host.ts :: handleInitialize` | `mcp-apps-conformance.test.ts :: every app capability the spec defines survives the handshake` |
| `availableDisplayModes` | `packages/integrations/src/mcp-apps-host.ts :: handleInitialize` | `mcp-apps-host.test.ts :: answers ui/initialize with host capabilities and hostContext` |

## `_meta` keys and capability declaration

| Item | Host handler | Test |
| --- | --- | --- |
| `_meta.ui.resourceUri` | `apps/api/src/mcp/apps/index.ts :: widgetMeta` | `apps/api/tests/mcp/mcp-apps.test.ts :: carries the linkage under the stable spec key as well as the extension id` |
| `_meta.ui.visibility` | `apps/api/src/mcp/apps/index.ts :: widgetMeta` | `apps/api/tests/mcp/mcp-apps.test.ts :: keeps semantic tools model-visible while confining legacy get to app callers` |
| `_meta.ui.csp` | `packages/integrations/src/mcp-apps-host.ts :: buildViewCsp` | `mcp-apps-host.test.ts :: adds exactly the origins the resource declared and nothing else` |
| `_meta.ui.permissions` | `packages/integrations/src/mcp-apps-host.ts :: buildViewPermissionsAllow` | `mcp-apps-host.test.ts :: grants only the permissions the resource asked for` |
| `_meta.ui.domain` | `packages/integrations/src/mcp-apps-sandbox.ts :: sandboxProxyDocument`<br>_Honoured as the host-controlled proxy origin. Per the spec this field is host-dependent; Docket serves every view from its own API-origin proxy rather than minting a per-resource subdomain._ | `mcp-apps-sandbox.test.ts :: accepts messages only from the host origin it was built for` |
| `_meta.ui.prefersBorder` | `apps/web/src/components/athena/mcp-app-view.tsx :: McpAppView` | `apps/web/tests/athena/mcp-app-view.test.tsx :: honours the resource border preference` |
| `capabilities.extensions["io.modelcontextprotocol/ui"]` | `packages/integrations/src/mcp-connector.ts :: MCP_UI_CLIENT_CAPABILITY` | `mcp-apps-conformance.test.ts :: declares the ui extension with the profile mimeType` |

## Resource and security conventions

| Item | Host handler | Test |
| --- | --- | --- |
| `ui:// resource scheme` | `packages/integrations/src/mcp-apps-host.ts :: isRenderableUiResource` | `mcp-apps-host.test.ts :: recognises only ui:// documents served with the profile mimeType` |
| `text/html;profile=mcp-app mimeType` | `packages/integrations/src/mcp-apps-host.ts :: isRenderableUiResource` | `mcp-apps-host.test.ts :: recognises only ui:// documents served with the profile mimeType` |
| `iframe sandbox` | `packages/integrations/src/mcp-apps-host.ts :: MCP_APP_VIEW_SANDBOX` | `mcp-apps-host.test.ts :: never grants the view an origin` |
| `restrictive default CSP` | `packages/integrations/src/mcp-apps-host.ts :: buildViewCsp` | `mcp-apps-host.test.ts :: builds a deny-all CSP when the resource declares nothing` |
| `sandbox proxy on a separate origin` | `apps/api/src/mcp/apps/sandbox.ts :: mcpAppSandboxHandler` | `apps/api/tests/mcp/mcp-apps-sandbox.test.ts :: serves the proxy from the API origin under its own policy` |
| `protocolVersion 2026-01-26` | `packages/types/src/mcp-apps.ts :: MCP_UI_PROTOCOL_VERSION` | `mcp-apps-conformance.test.ts :: speaks the version the committed spec publishes` |
