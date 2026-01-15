# Authentication Runbooks

Step-by-step procedures for common authentication operations.

---

## Rotate OAuth Credentials

**When:** Scheduled rotation, suspected compromise, or expiration.

**Steps:**

1. Generate new credentials in provider console
2. Update environment variable (`GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_SECRET`, or `MICROSOFT_CLIENT_SECRET`)
3. Deploy both web and API
4. Test sign-in flow
5. Revoke old credentials in provider console

---

## Force Sign-Out a User

**When:** User reports unauthorized access, suspicious activity.

**Steps:**

1. Find the user:

   ```sql
   SELECT id, email FROM users WHERE email = 'user@example.com';
   ```

2. Revoke all their sessions:

   ```sql
   DELETE FROM sessions WHERE user_id = '<user_id>';
   ```

User must sign in again.

---

## Block a Compromised Google Account

**When:** Manual intervention needed for compromised account.

**Steps:**

1. Block Google sign-in for user:

   ```sql
   UPDATE accounts
   SET google_sign_in_disabled = true
   WHERE user_id = '<user_id>' AND provider_id = 'google';
   ```

2. Revoke all sessions:

   ```sql
   DELETE FROM sessions WHERE user_id = '<user_id>';
   ```

---

## Renew Apple Client Secret

**When:** Every 6 months (Apple secrets expire).

**Steps:**

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

---

## Migrate Auth Database Schema

**When:** Schema changes to auth tables.

**Backup:**

```bash
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

**Apply migration:**

```bash
cd apps/api
pnpm build
pnpm drizzle-kit push --strict=false --force
```

**Verify:**

```bash
psql $DATABASE_URL -c "\d sessions"
```

**Rollback:**

```bash
psql $DATABASE_URL < backup-YYYYMMDD.sql
```

---

## Emergency: Revoke All Sessions

**When:** System-wide security incident.

**Steps:**

1. Truncate sessions table:

   ```sql
   TRUNCATE sessions;
   ```

2. All users will be signed out immediately

3. Monitor sign-in activity for anomalies

---

## Investigate Suspicious Sign-In Activity

**When:** Anomaly detected or user report.

**Steps:**

1. Check recent sessions for user:

   ```sql
   SELECT s.id, s.created_at, s.ip_address, s.user_agent
   FROM sessions s
   WHERE s.user_id = '<user_id>'
   ORDER BY s.created_at DESC;
   ```

2. Check for unusual session counts:

   ```sql
   SELECT user_id, COUNT(*)
   FROM sessions
   WHERE expires_at > NOW()
   GROUP BY user_id
   ORDER BY COUNT(*) DESC
   LIMIT 10;
   ```

3. If compromise suspected, force sign-out (see above)

---

_See also: [Auth Operations Guide](../engineering/auth-operations.md)_
