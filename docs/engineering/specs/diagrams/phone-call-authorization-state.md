# Phone call authorization state machine

This state machine defines the durable authorization record for a weakly attested inbound call or
an authenticated Docket `Call me` request. A callback may dial only the E.164 value already stored
on the linked `phone_number` row.

```mermaid
stateDiagram-v2
  [*] --> AwaitingHangup: weak inbound call
  [*] --> Dialing: Docket Call me
  AwaitingHangup --> Dialing: inbound completed
  Dialing --> AwaitingDigit: outbound answered
  AwaitingDigit --> Authorized: digit 1
  AwaitingDigit --> Failed: wrong digit or timeout
  Dialing --> Failed: busy, no answer, or provider failure
  AwaitingHangup --> Expired: five minutes elapsed
  Dialing --> Expired: five minutes elapsed
  AwaitingDigit --> Expired: five minutes elapsed
  Authorized --> Connected: relay session opened
  Connected --> Completed: call ended
  AwaitingHangup --> Canceled: phone access revoked
  Dialing --> Canceled: phone access revoked
  AwaitingDigit --> Canceled: phone access revoked
  Failed --> [*]
  Expired --> [*]
  Canceled --> [*]
  Completed --> [*]
```

All webhook transitions compare the expected call SID and current state. Repeated provider
webhooks return the current state and cannot create a second outbound call or voice session.
