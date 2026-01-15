# Authentication Operations Guide

> **Version**: 1.0.0
> **Last Updated**: 2026-01-14

How authentication works in Project Athena, how to set it up, and how to operate it.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Initial Setup](#initial-setup)
4. [Deployment](#deployment)
5. [OAuth Provider Configuration](#oauth-provider-configuration)
6. [Session Management](#session-management)
7. [Security](#security)
8. [Troubleshooting](#troubleshooting)
9. [Runbooks](#runbooks)

---

## Overview

### What We Use

**[Better Auth](https://www.better-auth.com)** - An open-source authentication library for TypeScript. Handles OAuth flows, session management, and passkeys. Runs inside the Next.js frontend, not the API server.

### Authentication Methods

| Method          | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| Google OAuth    | Primary sign-in method. Required.                                          |
| Apple OAuth     | Optional. For iOS users.                                                   |
| Microsoft OAuth | Optional. For enterprise users.                                            |
| Passkeys        | WebAuthn/biometric authentication. Users can register after first sign-in. |

### Key Concepts

**Session**: A 7-day token stored in a cookie (`better-auth.session_token`). Created on sign-in, validated on every API request.

**Account Linking**: Users can connect multiple OAuth providers to one account. If a user signs in with Google, then later signs in with Apple using the same email, both are linked to the same user record.

**OAuth Proxy**: A Better Auth feature that lets preview deployments (with unpredictable URLs) authenticate through the production server. Only the production URL needs to be registered with OAuth providers.

---

## Architecture

### System Components

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                                │
│                         Port 3000 (dev) / athena.hypertext.studio (prod) │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Better Auth                                                        │  │
│  │ Route: /api/auth/*                                                 │  │
│  │                                                                    │  │
│  │ Handles:                                                           │  │
│  │ - OAuth sign-in flows (Google, Apple, Microsoft)                  │  │
│  │ - Passkey registration and authentication                         │  │
│  │ - Session creation and cookie management                          │  │
│  │ - Account linking                                                  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Reads/writes sessions, users, accounts
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            PostgreSQL                                     │
│                                                                          │
│  Tables:                                                                 │
│  - users         (user profiles)                                         │
│  - sessions      (active sessions, 7-day TTL)                           │
│  - accounts      (OAuth provider links, tokens)                         │
│  - passkeys      (WebAuthn credentials)                                 │
│  - verifications (email verification tokens)                            │
└──────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ Validates sessions
                                    │
┌──────────────────────────────────────────────────────────────────────────┐
│                         API Server (Hono)                                 │
│                         Port 4000 (dev) / athena-api.hypertext.studio    │
│                                                                          │
│  The API server does NOT handle authentication flows.                    │
│  It only validates that incoming requests have a valid session.          │
│                                                                          │
│  Middleware: requireAuth                                                 │
│  - Extracts session token from cookie                                    │
│  - Looks up session in database                                          │
│  - Rejects request with 401 if invalid/expired                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### OAuth Sign-In Flow

```
1. User clicks "Sign in with Google" on frontend

2. Frontend redirects to Google:
   https://accounts.google.com/o/oauth2/v2/auth?
     client_id=...
     redirect_uri=https://athena.hypertext.studio/api/auth/callback/google

3. User authenticates with Google

4. Google redirects back to frontend:
   https://athena.hypertext.studio/api/auth/callback/google?code=...

5. Better Auth exchanges code for tokens, creates session:
   - INSERT INTO users (if new)
   - INSERT INTO accounts (store OAuth tokens)
   - INSERT INTO sessions (create session)
   - Set cookie: better-auth.session_token=<token>

6. User redirected to /home with active session
```

### Session Validation Flow (API Requests)

```
1. Client makes request to API:
   GET https://athena-api.hypertext.studio/api/tasks
   Cookie: better-auth.session_token=<token>

2. requireAuth middleware:
   - Extract token from cookie
   - SELECT FROM sessions WHERE token = <hashed_token>
   - Check expires_at > NOW()

3a. Valid session:
    - Attach user ID to request context
    - Continue to route handler

3b. Invalid/expired session:
    - Return 401 Unauthorized
```

---

## Initial Setup

### Prerequisites

- PostgreSQL 15+
- Node.js 20+
- pnpm 9+
- Google OAuth credentials (minimum requirement)

### Step 1: Create Database Tables

```bash
cd apps/api
pnpm build
pnpm drizzle-kit push --strict=false --force
```

Verify tables exist:

```bash
psql $DATABASE_URL -c "\dt"
```

You should see: `users`, `sessions`, `accounts`, `passkeys`, `verifications`, `backup_codes`

### Step 2: Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth 2.0 credentials (type: Web application)
3. Add authorized redirect URI:
   ```
   https://athena.hypertext.studio/api/auth/callback/google
   ```
4. Copy the Client ID and Client Secret

### Step 3: Set Environment Variables

Create `.env` files in both `apps/web` and `apps/api`:

**apps/web/.env:**

```env
# Auth configuration
BETTER_AUTH_SECRET=<run: openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000

# OAuth
GOOGLE_CLIENT_ID=<from step 2>
GOOGLE_CLIENT_SECRET=<from step 2>
```

**apps/api/.env:**

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/athena

# Auth (must match web app)
BETTER_AUTH_SECRET=<same as web>
BETTER_AUTH_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# OAuth (must match web app)
GOOGLE_CLIENT_ID=<same as web>
GOOGLE_CLIENT_SECRET=<same as web>
```

### Step 4: Verify Setup

```bash
# Terminal 1: Start API
cd apps/api && pnpm dev
# Should start on port 4000

# Terminal 2: Start frontend
cd apps/web && pnpm dev
# Should start on port 3000
```

Test the auth endpoint:

```bash
curl http://localhost:3000/api/auth/get-session
# Expected: {"session":null}
```

### Step 5: Test Sign-In

1. Open http://localhost:3000 in browser
2. Click "Sign in with Google"
3. Complete Google authentication
4. Verify you're redirected back and signed in

Check the database:

```sql
SELECT id, email, name FROM users;
SELECT id, user_id, provider_id FROM accounts;
SELECT id, user_id, expires_at FROM sessions;
```

---

## Deployment

### Environment Variables by Environment

#### Development (localhost)

```env
NODE_ENV=development
BETTER_AUTH_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
BETTER_AUTH_SECRET=any-string-at-least-32-characters
```

- Secure cookies: OFF (allows HTTP)
- OAuth proxy: OFF

#### Staging (athena-staging.hypertext.studio)

```env
NODE_ENV=production
BETTER_AUTH_URL=https://athena.hypertext.studio
FRONTEND_URL=https://athena-staging.hypertext.studio
BETTER_AUTH_SECRET=<unique secret for staging>
```

- Secure cookies: ON
- OAuth proxy: ON (redirects through production)

Note: `BETTER_AUTH_URL` points to **production**, not staging. This enables the OAuth proxy - staging authenticates through production, so you don't need to register staging URLs with OAuth providers.

#### Production (athena.hypertext.studio)

```env
NODE_ENV=production
BETTER_AUTH_URL=https://athena.hypertext.studio
FRONTEND_URL=https://athena.hypertext.studio
BETTER_AUTH_SECRET=<unique secret for production>
```

- Secure cookies: ON
- OAuth proxy: OFF (same origin)

### Deployment Checklist

Before deploying to production:

- [ ] `BETTER_AUTH_SECRET` is unique, randomly generated, 32+ characters
- [ ] `BETTER_AUTH_SECRET` is the same in both web and API deployments
- [ ] `NODE_ENV=production` is set
- [ ] OAuth redirect URIs are registered for `athena.hypertext.studio`
- [ ] Database migrations are applied
- [ ] HTTPS is configured

### Post-Deployment Verification

```bash
# Health check (API)
curl https://athena-api.hypertext.studio/health
# Expected: {"status":"ok","timestamp":"..."}

# Auth endpoint (Frontend)
curl https://athena.hypertext.studio/api/auth/get-session
# Expected: {"session":null}
```

Manual test:

1. Go to https://athena.hypertext.studio
2. Sign in with Google
3. Verify redirect and session cookie is set
4. Check cookie attributes in DevTools: `Secure=true`, `HttpOnly=true`

---

## OAuth Provider Configuration

### Google (Required)

**Console:** https://console.cloud.google.com/apis/credentials

**Redirect URI:**

```
https://athena.hypertext.studio/api/auth/callback/google
```

**Credential rotation:** Google client secrets don't expire, but rotate annually as a best practice.

### Apple (Optional)

**Console:** https://developer.apple.com/account/resources

**Redirect URI:**

```
https://athena.hypertext.studio/api/auth/callback/apple
```

**Credential rotation:** Apple client secrets (JWTs) expire after 6 months. Set a calendar reminder.

To generate a new Apple client secret:

```bash
npx apple-client-secret-generator \
  --teamId <TEAM_ID> \
  --keyId <KEY_ID> \
  --privateKeyPath ./AuthKey_<KEY_ID>.p8 \
  --clientId studio.hypertext.athena.web \
  --exp 15777000
```

The output JWT is your `APPLE_CLIENT_SECRET`.

### Microsoft (Optional)

**Console:** https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps

**Redirect URI:**

```
https://athena.hypertext.studio/api/auth/callback/microsoft
```

**Credential rotation:** Azure secrets have configurable expiration (6mo, 12mo, 24mo). Monitor in Azure Portal.

### OAuth Proxy (Preview Deployments)

The OAuth proxy allows Vercel preview deployments to authenticate without registering each preview URL.

**How it works:**

1. Preview deployment initiates OAuth with redirect to production
2. Production receives the callback from Google/Apple/Microsoft
3. Production encrypts the session data and redirects back to preview
4. Preview decrypts and creates the session

**Configuration:** No extra setup needed. Just ensure `BETTER_AUTH_URL` points to production in non-production deployments.

**Security:** Encrypted payloads expire after 60 seconds. The proxy only activates when `BETTER_AUTH_URL` differs from the current URL.

---

## Session Management

### Session Parameters

| Parameter    | Value                                            | Description                                |
| ------------ | ------------------------------------------------ | ------------------------------------------ |
| TTL          | 7 days                                           | Sessions expire after 7 days of inactivity |
| Refresh      | 1 day                                            | Session token refreshed after 1 day        |
| Cookie name  | `better-auth.session_token`                      |                                            |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `Secure` (prod only) |                                            |

### Viewing Sessions

```sql
-- All active sessions
SELECT s.id, u.email, s.created_at, s.expires_at, s.last_active_at
FROM sessions s
JOIN users u ON s.user_id = u.id
WHERE s.expires_at > NOW()
ORDER BY s.last_active_at DESC;

-- Sessions for a specific user
SELECT * FROM sessions WHERE user_id = '<user_id>';

-- Session count per user (detect anomalies)
SELECT user_id, COUNT(*)
FROM sessions
WHERE expires_at > NOW()
GROUP BY user_id
ORDER BY COUNT(*) DESC
LIMIT 10;
```

### Revoking Sessions

```sql
-- Revoke all sessions for a user (force sign-out)
DELETE FROM sessions WHERE user_id = '<user_id>';

-- Revoke a specific session
DELETE FROM sessions WHERE id = '<session_id>';

-- Revoke all expired sessions (cleanup)
DELETE FROM sessions WHERE expires_at < NOW();

-- Emergency: revoke ALL sessions
TRUNCATE sessions;
```

After revoking, the user must sign in again.

---

## Security

### Cookie Security

| Environment | `Secure` | `HttpOnly` | `SameSite` |
| ----------- | -------- | ---------- | ---------- |
| Development | No       | Yes        | Lax        |
| Production  | Yes      | Yes        | Lax        |

The `Secure` flag is automatically set when `NODE_ENV=production`. This requires HTTPS.

### RISC (Cross-Account Protection)

RISC = Risk and Incident Sharing and Coordination. A Google security feature that notifies us when a user's Google account is compromised.

When Google sends a RISC event:

| Event            | Our Response                                                 |
| ---------------- | ------------------------------------------------------------ |
| Account disabled | Set `accounts.google_sign_in_disabled = true`, block sign-in |
| Tokens revoked   | Clear stored OAuth tokens                                    |
| Sessions revoked | Delete all sessions for user                                 |

Database fields for RISC:

- `accounts.google_sign_in_disabled` - If true, Google sign-in is blocked
- `accounts.tokens_revoked_at` - When tokens were revoked
- `users.security_alert_at` - When user was notified of security issue

### Passkey Security

Passkeys are WebAuthn credentials (biometric, hardware key). The private key never leaves the user's device.

| Setting  | Value                              |
| -------- | ---------------------------------- |
| `rpID`   | `athena.hypertext.studio` (domain) |
| `origin` | `https://athena.hypertext.studio`  |

**Important:** Passkeys are domain-bound. If we change domains, all existing passkeys become invalid.

---

## Troubleshooting

### "Unauthorized" errors on API requests

**Symptom:** API returns 401 even though user signed in.

**Causes and solutions:**

1. **Cookie not sent:** Ensure `credentials: 'include'` on fetch requests.

   ```typescript
   fetch('https://athena-api.hypertext.studio/api/tasks', {
     credentials: 'include',
   });
   ```

2. **Cookie blocked by browser:** Check browser settings, third-party cookie policies.

3. **Session expired:** Sessions last 7 days. User needs to sign in again.

4. **Wrong domain:** Cookie is set for `athena.hypertext.studio`, won't be sent to other domains.

### OAuth redirect fails

**Symptom:** Google/Apple/Microsoft shows "Invalid redirect URI" error.

**Solution:** Verify the exact redirect URI is registered:

- Google: `https://athena.hypertext.studio/api/auth/callback/google`
- Apple: `https://athena.hypertext.studio/api/auth/callback/apple`
- Microsoft: `https://athena.hypertext.studio/api/auth/callback/microsoft`

Common mistakes:

- Missing `/api/auth/callback/` path
- HTTP instead of HTTPS
- Trailing slash mismatch

### Session not persisting after sign-in

**Symptom:** User signs in, gets redirected, but isn't logged in.

**Check:**

1. Cookie is set (DevTools > Application > Cookies)
2. Cookie has correct domain
3. `BETTER_AUTH_SECRET` matches between web and API

### Passkey registration fails

**Symptom:** "The operation either timed out or was not allowed"

**Causes:**

- User cancelled the browser prompt
- Device doesn't support WebAuthn
- `rpID` doesn't match current domain

### Apple sign-in suddenly stops working

**Cause:** Apple client secret expired (6-month limit).

**Solution:** Generate a new client secret (see [Apple configuration](#apple-optional)).

---

## Runbooks

### Runbook: Rotate OAuth Credentials

**When:** Scheduled rotation, suspected compromise, or expiration.

1. Generate new credentials in provider console
2. Update `GOOGLE_CLIENT_SECRET` (or Apple/Microsoft) in environment
3. Deploy both web and API
4. Test sign-in
5. Revoke old credentials in provider console

### Runbook: Force Sign-Out a User

**When:** User reports unauthorized access, suspicious activity.

```sql
-- Find user
SELECT id, email FROM users WHERE email = 'user@example.com';

-- Revoke all their sessions
DELETE FROM sessions WHERE user_id = '<user_id>';
```

User must sign in again.

### Runbook: Block a Compromised Google Account

**When:** Manual intervention needed for compromised account.

```sql
-- Block Google sign-in for user
UPDATE accounts
SET google_sign_in_disabled = true
WHERE user_id = '<user_id>' AND provider_id = 'google';

-- Also revoke sessions
DELETE FROM sessions WHERE user_id = '<user_id>';
```

### Runbook: Renew Apple Client Secret

**When:** Every 6 months (set calendar reminder).

1. Download `.p8` key from Apple Developer Portal (or use existing)
2. Generate new JWT:
   ```bash
   npx apple-client-secret-generator \
     --teamId <TEAM_ID> \
     --keyId <KEY_ID> \
     --privateKeyPath ./AuthKey.p8 \
     --clientId studio.hypertext.athena.web \
     --exp 15777000
   ```
3. Update `APPLE_CLIENT_SECRET` in environment
4. Deploy
5. Test Apple sign-in

### Runbook: Database Migration (Auth Tables)

**When:** Schema changes to auth tables.

1. Backup:

   ```bash
   pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
   ```

2. Apply migration:

   ```bash
   cd apps/api
   pnpm build
   pnpm drizzle-kit push --strict=false --force
   ```

3. Verify:
   ```bash
   psql $DATABASE_URL -c "\d sessions"
   ```

**Rollback:**

```bash
psql $DATABASE_URL < backup-YYYYMMDD.sql
```

---

## Quick Reference

### Environment Variables

| Variable                  | Required | Description                                         |
| ------------------------- | -------- | --------------------------------------------------- |
| `BETTER_AUTH_SECRET`      | Yes      | Session encryption. 32+ chars. Same in web and API. |
| `BETTER_AUTH_URL`         | Yes      | Production URL for OAuth callbacks.                 |
| `FRONTEND_URL`            | Yes      | Current deployment URL. For CORS.                   |
| `GOOGLE_CLIENT_ID`        | Yes      | From Google Cloud Console.                          |
| `GOOGLE_CLIENT_SECRET`    | Yes      | From Google Cloud Console.                          |
| `APPLE_CLIENT_ID`         | No       | Apple Services ID.                                  |
| `APPLE_CLIENT_SECRET`     | No       | Apple JWT. Expires every 6 months.                  |
| `MICROSOFT_CLIENT_ID`     | No       | Azure AD App ID.                                    |
| `MICROSOFT_CLIENT_SECRET` | No       | Azure AD secret.                                    |

### Credential Expiration

| Provider  | Expiration   | Action                          |
| --------- | ------------ | ------------------------------- |
| Google    | Never        | Rotate annually (best practice) |
| Apple     | 6 months     | **Mandatory** renewal           |
| Microsoft | Configurable | Monitor in Azure Portal         |

### Useful SQL

```sql
-- Active sessions
SELECT COUNT(*) FROM sessions WHERE expires_at > NOW();

-- Recent sign-ins
SELECT u.email, s.created_at
FROM sessions s
JOIN users u ON s.user_id = u.id
ORDER BY s.created_at DESC
LIMIT 10;

-- Users with most sessions (anomaly detection)
SELECT user_id, COUNT(*)
FROM sessions
GROUP BY user_id
ORDER BY COUNT(*) DESC
LIMIT 5;
```

---

_See also: [Deployment Guide](./deployment.md), [Architecture](./architecture.md)_
