# Athena phone authentication implementation plan

> **Reader**: The Athena engineer implementing and reviewing phone access.
> **Required outcome**: Ship phone linking and restricted calling without trusting caller ID as
> proof of account ownership.

## Decisions

Twilio Verify will own code generation, delivery, and provider checks. Docket will retain its own
attempt and send budgets, and those budgets will survive deletion of a pending phone binding.
Adding, verifying, re-enabling, or deleting a binding will require a passkey-fresh session.

An exact verified-number match remains necessary but is not sufficient. Twilio
`TN-Validation-Passed-A` may enter the restricted phone tool surface directly. Every missing,
failed, or weaker signal will end the inbound call and create a callback to the stored verified
number. The callback will require DTMF `1`. Docket will never use a destination supplied by an
inbound request.

The phone tool surface remains limited to continuing the canonical conversation, listing open
task titles, creating tasks, and completing tasks. Each mutation will create an atomic change set.
Athena will publish a post-call summary and will reject Undo when later work changed the task.

## Implementation order

1. Add failing domain, schema, and API tests for provider-owned verification, durable E.164 limits,
   legacy challenge compatibility, and fresh-session enforcement. Implement the provider port,
   Twilio REST adapter, schema migration, and route changes.
2. Add failing state-machine and route tests for A-attested entry, callback creation after inbound
   completion, destination integrity, DTMF confirmation, idempotency, expiry, cooldowns, and the
   authenticated `Call me` route. Implement the callback store and telephony port.
3. Add failing tests that pause and deletion terminate active calls and that a stale relay socket
   cannot dispatch another command. Implement local revocation first and best-effort Twilio call
   termination second.
4. Add failing tests for atomic voice change sets, post-call summaries, single and multiple change
   actions, successful Undo, duplicate Undo, and later-edit conflicts. Implement the summary API,
   notification intent, and service-worker action.
5. Add failing Web tests for the destination number, calling toggle, fresh-session retry, last call,
   `Call me`, callback explanation, and call-summary Undo controls. Implement the Settings and
   Athena timeline surfaces.
6. Update the phone specification and audit. Run focused tests after every red-green cycle, then
   run repository typecheck, lint, tests, and build with concurrency capped at two. Capture 390px
   and 1280px light and dark evidence before committing.

## Release boundary

The implementation may add configuration contracts and provider adapters. It must not create a
Twilio Verify service, buy or configure a number, write production secrets, deploy, or place a real
call without explicit user authorization. The code will ship with callback authorization disabled
until the required configuration exists.

## What would change this plan

The direct-entry rule must change if Twilio stops supplying `StirVerstat` on inbound webhooks or if
the restricted phone surface gains access to sensitive reads or irreversible actions. Android
phone-number credentials do not change the call design because they prove SIM control during app
linking and cannot authenticate a later PSTN caller.
