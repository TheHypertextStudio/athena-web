# Voice and phone

> **Status**: implemented (browser channel and telephony front door), pending a live provisioned number
> **Owner**: Athena / channels
> **Last updated**: 2026-08-02

Athena can be spoken to. In a browser, and on the telephone. Both are the **same conversation** —
the one `agent_session` of kind `chat` that `GET /v1/me/athena/chat` returns — and both run on the
same session engine. This document is the design, the protocol decisions, and the honest list of
what is and is not live.

---

## 1. The shape of the thing

```
                 ┌───────────────────────────────────────────────┐
  browser ─────► │  transport adapter (browser + /voice routes)  │──┐
   (WebRTC to    └───────────────────────────────────────────────┘  │
    the speech                                                      │
    model)                                                          ▼
                                                    ┌──────────────────────────────┐
                                                    │      VoiceSessionEngine      │
                                                    │  turn state · transcript ·   │
                                                    │  tool dispatch · barge-in    │
                                                    └──────────────────────────────┘
                 ┌───────────────────────────────────────────────┐  ▲
  telephone ───► │  transport adapter (Twilio ConversationRelay)  │──┘
   (PSTN into    └───────────────────────────────────────────────┘
    Twilio)                        │
                                   ▼
                        the one Athena conversation
                        (`session_activity` + `agent_session_transcript`)
```

Every channel-specific line of code lives in a transport adapter. The adapters translate their
provider's wire messages into a **channel-agnostic event vocabulary** and obey the commands they
get back. Nothing else about a channel is special.

|                    | browser                                                                                    | telephone                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| audio transport    | WebRTC, browser ↔ speech model                                                             | PSTN ↔ Twilio media servers                                                                 |
| speech-to-text     | the realtime model                                                                         | Deepgram, inside ConversationRelay                                                          |
| text-to-speech     | the realtime model                                                                         | ElevenLabs, inside ConversationRelay                                                        |
| language model     | the realtime model, in-band                                                                | Athena's own model, via `AthenaVoiceResponder`                                              |
| barge-in detection | server VAD in the speech model                                                             | Twilio media server (`interruptible="any"`)                                                 |
| adapter            | `apps/web/src/components/athena/voice-client.ts` + `apps/api/src/routes/voice-sessions.ts` | `apps/api/src/routes/twilio-relay-bridge.ts` + `twilio-relay-socket.ts` + `twilio-voice.ts` |
| engine             | `apps/api/src/routes/voice-engine.ts`                                                      | the same file                                                                               |

### Where Docket sits in the audio path: nowhere

In both channels the audio bytes never touch a Docket process. That is a latency decision made
once: a duplex conversation degrades badly past a couple of hundred milliseconds of added round
trip, and proxying Opus frames through a Cloud Run instance spends that budget on nothing. Docket
stays in the **control** path — transcripts, tool calls, entitlement, persistence — which is where
its authority actually is. A browser that lies about its events can only lie about its own
conversation.

---

## 2. The event vocabulary

`packages/types/src/voice.ts`. This is the contract between an adapter and the engine.

**Inbound** (adapter → engine): `user.transcript` (with `final`) · `assistant.transcript.delta` ·
`assistant.audio.start` · `assistant.audio.end` · `user.interrupted` (`spokenText`, `elapsedMs`) ·
`tool.call` · `dtmf` · `session.end`.

**Outbound** (engine → adapter): `speak` (`token`, `last`, `interruptible`) · `stop.audio` ·
`tool.result` · `end`.

The load-bearing absence: **there is no event carrying a finished assistant message.** The engine
receives what is happening _right now_ — a partial transcript, the start of audio, a word, a
barge-in at 460 ms — so no code path can wait for a completed reply and then synthesize it. That
is the structural difference between this and text-to-speech attached to the end of a chat
completion.

---

## 3. Entry and exit

**Entering.** A `Talk` control sits in the header of the Athena surface
(`apps/web/src/components/athena/voice-launch.tsx`). Pressing it opens
`VoiceMode` **in place** — no navigation, no route change, no settings tab. The panel requests the
microphone, `POST /v1/me/athena/voice` mints a session, and the browser opens its own audio link.

**Exiting.** `End voice` (or closing the panel, or navigating away, or unmounting) tears the client
down unconditionally: the microphone tracks are stopped, the audio context is closed, the peer
connection is closed, and `DELETE /v1/me/athena/voice/:id` stamps the session. The browser's
recording indicator staying lit after a person closed the panel is the most alarming way this
feature could misbehave, so teardown is not conditional on a successful request.

**Never a new conversation.** `POST /v1/me/athena/voice` returns `conversationId` — the same id
`GET /v1/me/athena/chat` returns, resolved through `resolveCanonicalConversation`. There is no
voice thread to fork from or merge back into.

---

## 4. The state model: listening · thinking · speaking

```
      ┌──────────┐  final transcript   ┌──────────┐  first audio   ┌──────────┐
      │ listening │────────────────────►│ thinking │───────────────►│ speaking │
      └──────────┘                     └──────────┘                └──────────┘
            ▲                                                            │
            │                    audio ends, or the person cuts in       │
            └────────────────────────────────────────────────────────────┘
```

`thinking` is a real state rather than a gap. It is the window in which Athena may already be doing
work — a tool call can start here and finish while she is `speaking` — and the surface has to be
able to say so instead of showing dead air. `idle` precedes the first turn; `ended` is terminal.

The panel renders the state as a word a person would use ("Listening", "Thinking", "Speaking") next
to a **live input meter driven by real microphone energy** sampled from the stream through an
`AnalyserNode`. Not an animation on a timer: the first thing anybody does in a voice mode is check
that it can hear them, and an indicator that moves regardless answers nothing.

---

## 5. Interruption

Barge-in is detected where it can be detected fast:

- **browser** — `turn_detection: { type: 'server_vad', interrupt_response: true }` is pinned into
  the realtime session at mint time. The model stops generating the instant it hears speech, with
  no client round trip and no button.
- **telephone** — `interruptible="any"` on `<ConversationRelay>`. Twilio's media server halts
  playback and sends an `interrupt` message carrying `utteranceUntilInterrupt` (what the caller
  actually heard) and `durationUntilInterruptMs`.

The engine's response, in order:

1. emit `stop.audio` **first**, before any `await`. Silence has to arrive at conversational
   latency; the database catches up afterwards.
2. persist Athena's turn as **what the person actually heard** (`spokenText`), flagged
   `interrupted: true`. The buffered remainder is discarded — as far as the conversation is
   concerned it never existed.
3. return to `listening`. The floor is theirs, with no button pressed.

Neither channel has push-to-talk, and neither has a button to interrupt.

---

## 6. Live transcript

Every spoken turn is written to the two places a typed turn is written, as it happens:

1. `session_activity` on the canonical `agent_session` — the visible timeline, interleaved with
   typed messages in `created_at` order;
2. `agent_session_transcript` — the durable `TurnMessage[]` the text agent loop resumes from, so
   something said out loud on Tuesday is context Athena has when you type on Wednesday.

There is deliberately **no voice transcript table**. A call log holding the only copy of what was
said is exactly the failure this design exists to prevent, so that copy does not exist to be the
only one.

The one thing a spoken row carries that a typed one does not is `body.voice`:

```jsonc
{ "channel": "web" | "phone", "voiceSessionId": "…", "interrupted": false }
```

A marker on the shared row, not a separate lane. The panel renders `· phone` and `· cut short` from
it.

---

## 7. Actions taken while speaking

`VoiceSessionEngine.receive` dispatches a `tool.call` **the moment it arrives, whatever the session
state**, including `speaking`. There is no pending-action array on the engine — deliberately,
because a queue is the mechanism by which "I'll do that at the end" happens by accident. A test
asserts the class holds no non-empty array.

The engine's `trace` records `audio.segment.start`, `tool.start`, `tool.end` and
`audio.segment.end` with a monotonic sequence and a wall clock, so "the action began before the
audio it overlapped finished" is a fact read out of the engine rather than a claim in a comment.

**Surfacing.** An action is written as a `session_activity` row with
`approvalStatus: 'executing'` the instant it starts — not `'proposed'`. A voice turn has no place
to render an approval queue and no way for a person to read a diff while listening; the action is
happening, and the honest representation is a row that says so from the beginning. The gated
proposal model remains the text surface's. The panel renders the row live, during speech.

On the telephone, the tool's own one-sentence summary is spoken inside the same turn, so the caller
hears the receipt rather than waiting for it.

**The voice tool surface is deliberately small**: `create_task`, `list_open_tasks`, `complete_task`
(`apps/api/src/routes/voice-tools.ts`). The constraint is the channel, not the effort — a person on
a call cannot read a diff, cannot scan forty proposed changes, and cannot un-hear "done", so voice
exposes only actions whose whole effect fits in one spoken sentence. `complete_task` refuses rather
than guessing when two titles match.

---

## 8. Errors, and what a person is told

Every failure is a **stable code** at the boundary and **application-owned copy** at the surface. No
provider text, no exception message, no HTTP status is ever rendered or spoken.

| code                 | what the person sees                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `microphone-denied`  | "Docket needs your microphone to talk. Allow it in your browser's site settings, then try again." |
| `microphone-missing` | "No microphone is available. Plug one in or pick one in your sound settings."                     |
| `audio-unsupported`  | "This browser can't run voice mode. Try Chrome, Edge, or Safari."                                 |
| `link-failed`        | "The voice connection didn't open. Try again in a moment."                                        |

`requestMicrophone` maps `NotAllowedError`/`SecurityError` → denied, `NotFoundError`/
`OverconstrainedError` → missing, everything else → unsupported. Three refusals that need three
different sentences, which an exception message would collapse into one unreadable string.

`VoiceProviderUnavailableError` carries an HTTP status and nothing else; the provider's body is
dropped at the boundary rather than carried and later accidentally rendered.

---

## 9. The telephone: the researched plan

### 9.1 Provider: Twilio, using `<ConversationRelay>`

Chosen over the alternatives for one reason that matters more than the others: **it does streaming
speech-to-text and streaming text-to-speech inside its own media path and speaks JSON over a
WebSocket**, so audio starts playing from our first token and barge-in is handled where the media
is. The alternatives:

- **Twilio `<Gather>` + `<Say>`** — turn-based by construction. Every turn is record-then-respond,
  there is no barge-in, and it would fail the "live and duplex" bar outright.
- **Twilio Media Streams (raw `<Stream>`)** — gives us μ-law frames and nothing else. We would own
  STT, TTS, VAD and jitter buffering. More control, far more surface, and no advantage for this
  product.
- **LiveKit / Vonage / Telnyx** — comparable; Twilio's relay is the most direct fit and the SDK
  surface we need is a webhook plus a WebSocket, which is why this implementation carries **no
  Twilio SDK dependency at all** (the signature check is 20 lines of `node:crypto`).

### 9.2 Number provisioning

One Docket-owned number, configured in the Twilio console (or via the API) with:

- **Voice → A call comes in**: `POST https://<api-host>/internal/telephony/twilio/voice`
- **Call status changes**: `POST https://<api-host>/internal/telephony/twilio/status`

Both URLs derive from `requireOrigin(apiHostConfig, 'api')`, so a domain cutover moves them without
a code change. `TWILIO_PHONE_NUMBER` records the number the product tells people to call.

### 9.3 Media transport into the engine

TwiML answers a permitted call with:

```xml
<Connect>
  <ConversationRelay url="wss://<api-host>/internal/telephony/twilio/relay"
                     welcomeGreeting="Hi Ada, it's Athena. What's on your mind?"
                     interruptible="any"
                     reportInputDuringAgentSpeech="speech"
                     dtmfDetection="true"
                     ttsProvider="ElevenLabs"
                     transcriptionProvider="Deepgram"
                     language="en-US">
    <Parameter name="voiceSessionId" value="…"/>
  </ConversationRelay>
</Connect>
```

The session id rides as a `<Parameter>`, which Twilio hands back verbatim in the socket's `setup`
message. **The socket therefore never re-derives identity** — a socket that read the caller from
`setup.from` would be a second, weaker authentication path for the same call, reachable by anyone
who can open a WebSocket. It looks the session up by id and closes with 1008 if it cannot find one.

The WebSocket server itself is `apps/api/src/routes/voice-websocket.ts`: a ~200-line RFC 6455
implementation covering exactly the slice this protocol uses (masked client text frames,
continuation frames, ping/pong, close), tested against its own decoder. `permessage-deflate` is
never negotiated; a binary frame is closed with 1003; an unmasked client frame is closed with 1002;
a payload over 256 KiB is refused with 1009 rather than buffered.

### 9.4 Caller identification

`resolveCaller` (`apps/api/src/routes/phone-directory.ts`) is one equality read against
`phone_number` rows that are **both `verified` and `callingEnabled`**. No fuzzy matching, no
last-7-digits fallback. A partial unique index — `phone_number_verified_unique_idx` on `e164`
`WHERE status = 'verified'` — makes it impossible for two accounts to hold the same verified
number, so the lookup either finds exactly one account or finds none, and "none" cannot read or
append to anybody's conversation because no user id is ever obtained.

Caller id is spoofable. That is exactly why the match is exact, and why the voice tool surface is
small enough that a spoofed call cannot do quiet damage.

### 9.5 Entitlement gating

Before a session exists:

1. signature check — a forged request gets `403` and no TwiML at all;
2. caller resolution — unrecognized hears `unrecognizedCallerAnnouncement`;
3. `isAthenaEntitled(workspace)` — which wraps the same
   `assertProductCapability(orgId, 'voice')` check used by the web path. An organization without
   Docket Pro hears `productRequiredAnnouncement`;
4. only then `openVoiceSession`.

A gated caller creates **no** voice session, **no** conversation turn, and **no** model call. The
test asserts a before/after footprint of zero.

### 9.6 The gating announcement

```
Hi, this is Athena from Docket.
Calling Athena requires Docket Pro, and this organization does not have it.
A workspace administrator can add Docket Pro at docket.place slash pricing. That is https://docket.place/pricing.
After Docket Pro is active, call this number again.
```

Three properties, each tested:

- **It dictates a specific URL**, spoken (`speakableUrl` drops the scheme and says "slash") and
  again written for the transcript. "Our website" would be a dead end for somebody holding a phone.
  The host comes from `requireOrigin(apiHostConfig, 'app')`, so it follows the product apex.
- **It is friendly**: opens with a greeting, closes with a next step, and contains none of
  "denied", "forbidden", "unauthorized", "invalid", "failed", no HTTP status, and no error codes.
- **It reveals nothing.** The unrecognized-caller announcement deliberately does not say _why_ —
  distinguishing "unknown number" from "awaiting verification" would turn the phone line into an
  oracle for testing whether a number belongs to a Docket customer.

### 9.7 Failure modes

| failure                                   | behaviour                                                                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| forged/unsigned webhook                   | `403`, no TwiML, nothing created                                                                                                                                                                               |
| caller id withheld or malformed           | unrecognized announcement; no account reached                                                                                                                                                                  |
| dropped call mid-turn                     | socket close → `session.end`; what was said up to that point is already persisted, because every turn is written as it happens rather than at hang-up                                                          |
| socket dies without a close frame         | close code 1006 → `transport_closed` on the session row                                                                                                                                                        |
| carrier leg fails after the webhook       | the `/status` callback closes the session                                                                                                                                                                      |
| provider outage (realtime)                | `VoiceProviderUnavailableError(status)`; the browser panel shows `link-failed` copy                                                                                                                            |
| process restart mid-call                  | the session ends — the audio link died with it. The transcript up to that instant is durable. This is a stated scope limit: a voice session is bound to one process for its lifetime, because its transport is |
| SMS carrier refuses the verification code | the challenge is recorded with `deliveryFailed`, and the settings surface says the code is not coming rather than leaving the person waiting                                                                   |

---

## 10. Phone verification

`apps/api/src/routes/phone-verification.ts`. A number is a **credential**, so:

- **The send creates the challenge.** The row is written after the transport accepts the message, so
  a challenge that was never delivered cannot exist as an outstanding one. (The bug this replaces
  generated a code and never sent it, making verification impossible for any real person.)
- **Only a SHA-256 is stored**, compared with `timingSafeEqual`.
- **The attempt is counted before the comparison**, so abandoning the request mid-flight does not
  buy a free guess.
- **A resend retires the previous code**, so pressing "resend" narrows the valid set rather than
  widening it.

| limit          | value           | why                                                                                      |
| -------------- | --------------- | ---------------------------------------------------------------------------------------- |
| code lifetime  | 10 minutes      | long enough to walk to the other room, short enough that a shoulder-surfed code is stale |
| wrong attempts | 5 per challenge | 5 tries against a 6-digit space is 1-in-200 000, and the challenge is destroyed after    |
| resend gap     | 60 seconds      | stops "resend" becoming an SMS cannon aimed at somebody else's phone                     |
| sends per hour | 5 per number    | caps the cost and the harassment of enumerating numbers                                  |

The number is entered as a **country selection plus a national number** — `PhoneNumberCreate` has
no `e164` field at all, so a client cannot submit an ambiguous string. Every read shape returns
`+1 ••• ••• ••23`; the full national number is never returned, even to its owner, because a stolen
session token must not become a directory.

`callingEnabled` is separate from `status`: pausing "Athena may answer calls from this number"
must not throw away the proof of ownership, or every pause would cost another SMS round trip.

---

## 11. Ports, adapters, and running with zero external accounts

| seam                     | real adapter                                                                                       | local/test double                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| realtime speech          | `OpenAiRealtimeProvider` — mints an ephemeral client secret via `POST /v1/realtime/client_secrets` | `MockRealtimeProvider` — a fixture credential with `transport: 'mock'` |
| language model (phone)   | `AthenaVoiceResponder` over the container's `AgentTurnRuntime`                                     | the same class over `MockAgentTurnRuntime`                             |
| SMS (verification codes) | the existing `RealSmsSender`                                                                       | the existing `CaptureSmsSender`                                        |
| telephony                | the Twilio webhook + relay socket                                                                  | driven directly in tests; no account, no telephone                     |

`resolveVoiceProvider` always chooses the double in `local`/`test`, even if a real key is present —
a developer's stray key must never turn a test run into a billed call.

Locally, a browser voice session also gets the `AthenaVoiceResponder`, so the fixture path
exercises the real engine, the real persistence and the real tool dispatch, with only the audio
simulated. The microphone is still opened for real, so the input meter reads genuine energy.

### Environment

All optional; absent means the doubles run.

| var                                             | meaning                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                | realtime speech credential (ephemeral secrets are minted from it; it never reaches a browser) |
| `VOICE_REALTIME_MODEL` / `VOICE_REALTIME_VOICE` | overrides for the pinned model and voice                                                      |
| `TWILIO_ACCOUNT_SID`                            | the account owning the Athena number                                                          |
| `TWILIO_AUTH_TOKEN`                             | the key every inbound webhook signature is verified against                                   |
| `TWILIO_PHONE_NUMBER`                           | the number people call                                                                        |

---

## 12. What is live, and what is not

**Live and tested.** The session engine and both adapters; the browser panel end to end against the
fixture provider; phone verification with real delivery, expiry, attempt and rate limits; caller-id
resolution in both directions; the entitlement gate with a zero-footprint assertion; the
announcements; the TwiML; the ConversationRelay translation table; the WebSocket frame codec.

**Not verifiable here.** Placing a real telephone call. That needs a provisioned Twilio number and
a live account, neither of which exists in this environment. The webhook, the TwiML, the socket and
the engine are all exercised, but nobody has dialled the number, and this document does not claim
otherwise.

**Deliberately out of scope for launch.** Multi-party calls, outbound calls (Athena calling you),
call recording, non-English languages beyond `<Language>` configuration, and voice access to the
full MCP toolbox.
