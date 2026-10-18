---
name: connect
description: Use when Docket MCP tools are unavailable, OAuth consent is needed, or an existing connection has authentication, permission, or workspace-visibility problems. For product setup and a first useful workflow, use onboard.
---

# Connect Docket

Resolve access as one part of a workflow. For a general “get started” request, use
[onboard](../onboard/SKILL.md), which guides the person from their goal to a useful first result.
If onboarding called this skill, return to its unfinished workflow after access is established.

The plugin bundles `https://api.clearthedocket.com/mcp`, a remote Streamable HTTP server using OAuth.
There is no local server, API key file, or shared credential to install.

1. Check whether the host exposes the plugin's Docket tools. If present, call `workspaces` once to
   verify authenticated access. An empty result is an account with no visible workspaces, not proof
   that the connection failed.
2. If the host requires authentication, guide the person through its MCP connection and OAuth consent
   flow. Use the API endpoint above; let the client discover the authorization server and use PKCE.
   Never copy another client's tokens or create a parallel credential store.
3. If the person already configured Docket manually, explain any duplicate connection and let them
   choose which to keep. Do not remove their existing configuration or initiate repeated sign-ins.
4. Report the observed connection result and visible workspace choices. Connecting does not authorize
   creating sample tasks or modifying work. A read check proves only the tools/grants it exercised.

If tools remain missing, distinguish an unloaded plugin from an unauthenticated server or insufficient
scope. Ask for the specific missing host action and continue connection-independent work. The
`get-back-on-track` skill can use previously retrieved task context provisionally until the connection
returns. See the plugin [README](../../README.md) for host setup.
