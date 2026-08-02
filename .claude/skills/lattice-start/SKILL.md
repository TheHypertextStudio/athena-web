---
name: lattice-start
description: "Integrate Lattice as the AI/LLM back end for this app — power an assistant, agent, or chat feature with Lovelace compute, including each user's own Ollama/LM Studio models via user-authorized OAuth. Use when adding an AI backend, installing @reasonabletech/lattice-client, or replacing an OpenAI/LLM client with Lattice. Drives the whole integration — SDK install, CLI, developer app + OAuth, and wiring."
---

# /lovelace-developers:lattice-start

Drive this project to use **Lattice** as the back end for its AI features — the
model calls that power an assistant, agent, or any LLM feature. Lattice routes
each request either to Lovelace-hosted capacity, marketplace providers, or, with
the user's authorization, that user's **own paired runtime** (their machine
running Ollama or LM Studio). The credential model here is **user-authorized
OAuth**: each end user signs in with Lovelace and consents, so their requests run
on their own compute.

Work through the steps in order. At each step, detect what this repo already
uses and fit into it — do not scaffold a new framework or restructure the app.
Stop and ask the user only where a human decision or credential is genuinely
required (marked **[ask the user]**).

## 1. Understand the project, then install the SDK

1. Detect the stack: read the manifest (`package.json`, `pyproject.toml`,
   `Cargo.toml`, `go.mod`, etc.) and note the package manager and language.
2. Find where AI/model calls already happen (search for existing LLM clients,
   an `assistant`/`agent`/`chat` module, or the place the user names). That is
   where Lattice will plug in.
3. Install the Lattice SDK for the detected language:
   - **TypeScript/JavaScript:** `pnpm add @reasonabletech/lattice-client`
     (or the repo's package manager: `npm install` / `yarn add` / `bun add`).
   - **Python:** `pip install lovelace-compute` (or `uv add` / `poetry add`).
   - Other languages: check <https://developer.uselovelace.com/lattice-cloud>
     for the current SDK; if none exists, use the OpenAI-compatible HTTP API at
     `https://lattice.uselovelace.com/v1` directly.

## 2. Download the CLI for local testing

The `lattice-ctl` CLI lets you run and inspect a local daemon while developing.

1. Install it:
   - macOS / Linux: `curl -fsSL https://d.uselovelace.com/install | sh`
   - Windows (PowerShell): `irm https://uselovelace.com/lattice/install.ps1 | iex`
   - Or see the full matrix (Homebrew, APT, WinGet) at
     <https://uselovelace.com/downloads>.
2. Verify: `lattice-ctl --version`, then `lattice-ctl status`.
3. For local model serving during development, the daemon can front **Ollama**
   or **LM Studio**. Point it at LM Studio's OpenAI-compatible server with
   `LATTICE_LMSTUDIO_BASE_URL` (default `http://localhost:1234/v1`) or Ollama
   with `LATTICE_OLLAMA_BASE_URL` (default `http://localhost:11434`).

## 3. Create a developer account and register an app

**[ask the user]** — this requires a human with a browser:

1. Direct the user to create a developer account at
   <https://developer.uselovelace.com>.
2. Have them register an OAuth app (create-app flow) and configure:
   - a **redirect URI** that matches this app's callback route (detect or ask
     for it — e.g. `http://localhost:3000/api/auth/lattice/callback` in dev),
   - the **scopes** `lattice:compute:inference` (required),
     plus `lattice:compute:marketplace` and `lattice:compute:catalog:read` if the
     app should use marketplace capacity or browse the model catalog.
3. Collect the **client ID** (and client secret, for a confidential server-side
   app). Store them as environment variables — never commit them. Add
   `LATTICE_CLIENT_ID` (and `LATTICE_CLIENT_SECRET`) to the project's env
   template and secret store.

When the user consents during sign-in, they will see a consent screen listing
the Lattice compute permissions the app is requesting; approval is what lets the
app run requests as that user.

## 4. Wire Lattice into the app's existing framework

Fit the SDK into the AI code found in step 1 — reuse the project's config,
env-loading, and error-handling conventions.

1. **OAuth sign-in:** add (or extend) a "Sign in with Lovelace" flow using the
   authorization-code + PKCE flow against
   `https://accounts.uselovelace.com`. Store each user's access/refresh tokens
   the way the app already stores session/auth state.
2. **Construct the client with the user's token** so requests run on that user's
   compute. In TypeScript:

   ```ts
   import { LatticeClient } from "@reasonabletech/lattice-client";

   const lattice = new LatticeClient({
     credential: { kind: "oauth", accessToken: userAccessToken },
   });

   const reply = await lattice.chatComplete({
     model: "lovelace:default",
     messages: [{ role: "user", content: prompt }],
   });
   ```

   To target the user's own paired runtime, use
   `chatCompleteForPersonalRuntime(latticeId, request)`.

3. **Replace the app's existing model call** with the Lattice call, keeping the
   surrounding streaming, tool-calling, and error handling intact. The API is
   OpenAI-compatible, so an existing OpenAI-style integration usually needs only
   the base URL/credential swapped.
4. **Handle token refresh and the `insufficient_scopes` / revoked-grant errors**
   the SDK surfaces — re-run the OAuth flow when a user's grant is missing.

## 5. Verify end to end

1. Start the app and the local daemon; sign in as a test user and approve the
   consent screen.
2. Trigger an AI feature and confirm a real completion comes back through
   Lattice (check `lattice-ctl status` and the app logs).
3. Confirm requests are attributed to the signed-in user (the token, not a
   shared key), so usage and compute are the user's own.

## Done when

Stop and hand back to the user once all of these hold — verify each, don't
assume:

- [ ] The Lattice SDK is a dependency in the manifest and imports resolve.
- [ ] `lattice-ctl status` runs and reports the daemon.
- [ ] An OAuth app exists (client id in the env template) with the
      `lattice:compute:inference` scope.
- [ ] The app's existing model call is replaced by a `LatticeClient` call
      constructed with the signed-in user's token, and typecheck/build passes.
- [ ] The end-to-end test in step 5 returns a real completion attributed to the
      signed-in user.

Then summarize: the SDK added, the CLI installed, where the client id lives, the
files changed to route AI through Lattice, and how to run the end-to-end test.
Explicitly flag anything that still needs a human (production redirect URIs,
secret provisioning, publishing the app). Do not claim done until the checklist
above is verified — a compiling integration that has not returned a real
user-attributed completion is not finished.
