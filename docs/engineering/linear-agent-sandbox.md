# Linear Agent sandbox release gate

> **Reader:** The engineer releasing Athena's Linear Agent integration. The reader must complete
> this gate in a disposable Linear workspace before changing `LINEAR_AGENT_ENABLED` in any shared
> environment.

Linear Agent stays disabled in production. The Cloud Run manifest sets
`LINEAR_AGENT_ENABLED=false`, and credentials do not override that flag.

Use a disposable Linear workspace and a non-production Athena deployment. Install the dedicated
Linear Agent OAuth app through Settings → Connections. Do not reuse the ordinary Linear issue-sync
OAuth app because the Agent app has a separate client, webhook secret, and workspace installation.

Capture one real `AgentSessionEvent` request body from that workspace. Remove names, issue text,
URLs, and identifiers that the contract does not require. Keep the event type and object shape.
Run the signed replay probe with the sandbox app's webhook secret:

```sh
LINEAR_AGENT_SANDBOX_API_URL=https://api.preview.example \
LINEAR_AGENT_WEBHOOK_SECRET='<sandbox secret>' \
pnpm linear-agent:sandbox-check ./linear-agent-event.redacted.json
```

The script refuses hosts that do not contain `sandbox`, `staging`, or `preview`, apart from local
hosts. It replaces `webhookTimestamp` with the current time, signs the exact request bytes, and
posts them to the Agent ingest route. An HTTP success proves signature verification and durable
inbox admission. It does not prove the complete interaction.

Complete one provider-native round trip before enabling the flag. Start Athena from a Linear
issue. Send a follow-up. Approve and reject separate actions. Complete the account-link prompt.
Stop a running session. Confirm the final response appears in the same Linear thread. Replay the
same delivery and confirm Athena does not create a second run. Revoke the installation and confirm
Athena records a terminal connection error and notifies the installer once. Reinstall it and
confirm the relay resumes without reposting older activity.

Record the sandbox workspace, Athena deployment SHA, UTC time, redacted event fixture, screenshots,
and each result in `docs/WORKLOG.md`. Only then may the production deployment set
`LINEAR_AGENT_ENABLED=true` and mount the three `LINEAR_AGENT_*` secrets. Verify the deployed SHA,
health route, scheduled session sweep, inbound-event drain, relay retry state, and one new Linear
round trip after the rollout.
