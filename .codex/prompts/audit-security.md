---
description: Comprehensive security audit for detecting vulnerabilities, verifying authentication/authorization, and ensuring compliance with security best practices. Use before releases, after adding auth-related features, or when reviewing security posture.
argument-hint: [SCOPE=<session|full|auth|authz|input|crypto|api>]
---

# Security Audit

Perform a thorough security audit to identify vulnerabilities, verify security controls, and ensure compliance with OWASP guidelines and security best practices.

## Usage

```
/prompts:audit-security              # Full audit
/prompts:audit-security SCOPE=auth   # Authentication only
/prompts:audit-security SCOPE=input  # Input validation only
```

Run the phases corresponding to `$SCOPE`. Default to full audit if not specified.

---

## Phase 0: Scope Detection

### Determine Changed Files

Before auditing, identify the scope of changes:

```bash
# Get list of changed files (staged + unstaged + untracked)
CHANGED_FILES=$(git status --porcelain | awk '{print $NF}' | grep -E '\.(ts|tsx)$')
echo "Changed files: $(echo "$CHANGED_FILES" | wc -l | tr -d ' ')"
echo "$CHANGED_FILES"
```

### Determine Audit Type

```
What kind of audit is needed?
├── SESSION AUDIT (default) → Only changed files in current session
│   Use when: After implementing a feature, fixing a bug
│   Scope: Files from git status (uncommitted changes only)
│
├── FULL AUDIT → All phases, entire codebase
│   Use when: Pre-release, after major changes, periodic security review
│   ⚠️  Requires explicit SCOPE=full
│
├── TARGETED AUDIT → Specific area only
│   ├── auth → Phase 1 (authentication & sessions)
│   ├── authz → Phase 2 (authorization & access control)
│   ├── input → Phase 3 (validation & injection)
│   ├── crypto → Phase 4 (cryptography & secrets)
│   ├── api → Phase 5 (API & network security)
│   ├── integrations → Phase 6 (third-party security)
│   └── data → Phase 7 (database & data security)
│
└── QUICK SCAN → Automated checks only
    Use when: CI/CD pipeline, quick sanity check
```

### Session vs Full Scope Commands

When `SCOPE=session` (default), scope all automated checks to changed files:

```bash
# Store changed files for reuse throughout audit
CHANGED_FILES=$(git status --porcelain | awk '{print $NF}' | grep -E '\.(ts|tsx)$')

# Exit early if no relevant changes
if [ -z "$CHANGED_FILES" ]; then
  echo "No uncommitted TypeScript changes to audit."
  exit 0
fi
```

### Gather Baseline Information

**Session scope (default):**

```bash
CHANGED_FILES=$(git status --porcelain | awk '{print $NF}' | grep -E '\.(ts|tsx)$')

# Count endpoints in changed files only
[ -n "$CHANGED_FILES" ] && echo "$CHANGED_FILES" | xargs grep -E "\.get\(|\.post\(|\.put\(|\.patch\(|\.delete\(" 2>/dev/null | wc -l

# Find middleware usage in changed files
[ -n "$CHANGED_FILES" ] && echo "$CHANGED_FILES" | xargs grep "\.use\(" 2>/dev/null | head -10
```

**Full scope (explicit SCOPE=full):**

```bash
# List all API routes (adapt path to your project)
find . -path "*/routes/*" -name "*.ts" -type f

# Count total endpoints
grep -rE "\.get\(|\.post\(|\.put\(|\.patch\(|\.delete\(" --include="*.ts" | wc -l

# List middleware in use
grep -r "\.use\(" --include="*.ts" | head -20
```

---

## Phase 1: Authentication & Session Security

### 1.1 Route Protection Audit

**Automated Checks:**

```bash
# Find routes that might be unprotected (adjust auth middleware name)
grep -rL "requireAuth\|isAuthenticated\|protect\|authMiddleware" --include="*.ts" $(find . -path "*/routes/*" -type d)

# Find user-specific operations that should be protected
grep -r "userId\|user\.id\|req\.user" --include="*.ts" | grep -v "auth\|middleware" | head -20
```

**Decision Tree - Route Protection:**

```
Does this route handle user-specific data?
├── YES → Is authentication middleware applied?
│   ├── YES → Is it applied BEFORE the handler?
│   │   ├── YES → PASS
│   │   └── NO → CRITICAL: Middleware order allows bypass
│   └── NO → CRITICAL: Unprotected user endpoint
│
└── NO → Is this intentionally public?
    ├── YES → Verify no sensitive data leakage
    │   ├── Returns only public info → PASS
    │   └── Could leak user data → HIGH: Information disclosure
    └── NO → Needs review with product owner
```

### 1.2 Session Security Checklist

**Required Session Cookie Settings:**

| Setting    | Required Value       | Severity if Missing              |
| ---------- | -------------------- | -------------------------------- |
| `secure`   | `true` in production | HIGH: Session hijacking via HTTP |
| `httpOnly` | `true`               | HIGH: XSS can steal session      |
| `sameSite` | `lax` or `strict`    | MEDIUM: CSRF vulnerability       |
| `maxAge`   | ≤7 days recommended  | LOW: Long-lived sessions         |

**Automated Check:**

```bash
# Find session/cookie configuration
grep -rE "cookie|session|secure:|httpOnly|sameSite" --include="*.ts" | head -20
```

### 1.3 OAuth Security Checklist

- [ ] **State parameter** used to prevent CSRF attacks
- [ ] **PKCE** enabled for public clients (SPAs, mobile apps)
- [ ] **Token storage** uses httpOnly cookies, not localStorage
- [ ] **Refresh tokens** have appropriate expiration
- [ ] **Redirect URIs** validated strictly (no open redirects)
- [ ] **Account linking** validates email ownership before linking

### 1.4 Password/Credential Security

**Decision Tree - Is Password Handling Secure?**

```
How are passwords stored?
├── Plain text → CRITICAL: Must hash immediately
├── MD5/SHA1/SHA256 alone → CRITICAL: Use bcrypt/scrypt/argon2
├── bcrypt/scrypt/argon2 → Check parameters:
│   ├── bcrypt rounds ≥10 → PASS
│   ├── scrypt N ≥2^17 → PASS
│   └── argon2 with recommended params → PASS
└── Unknown → Investigate immediately
```

---

## Phase 2: Authorization & Access Control

### 2.1 Resource Ownership Validation

**Automated Check:**

```bash
# Find database queries without user/owner checks
grep -rE "findOne|findFirst|findById|where.*id" --include="*.ts" | grep -v "userId\|ownerId\|createdBy" | head -20

# Find potential IDOR patterns (direct object reference)
grep -rE "params\.(id|.*Id)|req\.params\." --include="*.ts" | head -20
```

**Decision Tree - IDOR Prevention:**

```
Does this endpoint access a resource by ID?
├── YES → Is there an ownership check?
│   ├── YES → Is it atomic with the query?
│   │   ├── YES (WHERE id=X AND userId=Y) → PASS
│   │   └── NO (separate queries) → MEDIUM: Race condition risk
│   └── NO → CRITICAL: IDOR vulnerability
│
└── NO → Is the resource truly public?
    └── Verify access control requirements
```

**Secure vs Insecure Patterns:**

```typescript
// SECURE - Ownership validated atomically
const resource = await db.findFirst({
  where: { id: resourceId, userId: currentUser.id },
});

// INSECURE - Vulnerable to IDOR
const resource = await db.findFirst({
  where: { id: resourceId }, // No ownership check!
});
```

### 2.2 Role-Based Access Control

**Checklist:**

- [ ] Roles defined with principle of least privilege
- [ ] Role checks happen server-side (not just UI)
- [ ] Admin functions require admin role verification
- [ ] Role escalation prevented (can't set own role)
- [ ] Sensitive operations require re-authentication

### 2.3 Multi-Tenancy Isolation

```bash
# Find queries that might cross tenant boundaries
grep -rE "findMany|select\s*\(" --include="*.ts" | grep -v "userId\|tenantId\|organizationId" | head -20
```

**Checklist:**

- [ ] All queries include tenant identifier
- [ ] Aggregate queries don't leak cross-tenant data
- [ ] File storage isolated by tenant
- [ ] Caches scoped to tenant

---

## Phase 3: Input Validation & Injection Prevention

### 3.1 Input Validation

**Automated Check:**

```bash
# Find handlers potentially accepting unvalidated input
grep -rE "req\.body|req\.query|req\.params" --include="*.ts" | grep -v "validate\|schema\|zod\|joi\|yup" | head -20

# Find direct JSON parsing without validation
grep -r "JSON\.parse\|\.json()" --include="*.ts" | head -10
```

**Decision Tree - Input Validation:**

```
Does this endpoint accept user input?
├── YES → Is there schema validation?
│   ├── YES (Zod/Joi/Yup) → Are all fields validated?
│   │   ├── Emails use email validator → Check
│   │   ├── URLs use URL validator → Check
│   │   ├── IDs use UUID/format validator → Check
│   │   ├── Enums restricted to valid values → Check
│   │   └── All constraints applied → PASS
│   └── NO → HIGH: Unvalidated input
│
└── NO → Verify truly no user input
```

### 3.2 SQL Injection Prevention

**Automated Check:**

```bash
# Find raw SQL (dangerous if with user input)
grep -rE "\.query\(|\.execute\(|sql\`|\.raw\(" --include="*.ts" | head -20

# Find string concatenation in SQL context
grep -rE "SELECT.*\+|INSERT.*\+|UPDATE.*\+|DELETE.*\+" --include="*.ts"

# Find template literals with variables in SQL
grep -rE "sql\`.*\$\{|query\`.*\$\{" --include="*.ts"
```

**Checklist:**

- [ ] All queries use parameterized statements or ORM
- [ ] No string concatenation with user input in SQL
- [ ] Dynamic column/table names whitelisted, not user-controlled
- [ ] ORM used correctly (no raw queries with user data)

### 3.3 XSS Prevention

**Automated Check:**

```bash
# Find dangerous HTML insertion
grep -r "dangerouslySetInnerHTML\|innerHTML\|outerHTML" --include="*.tsx" --include="*.jsx"

# Find user content rendering
grep -rE "user\.|content\.|message\.|comment\." --include="*.tsx" | head -20
```

**Checklist:**

- [ ] No `dangerouslySetInnerHTML` with user content
- [ ] React's default escaping not bypassed
- [ ] Markdown rendering uses sanitization (DOMPurify, sanitize-html)
- [ ] URLs validated before rendering as links
- [ ] CSP headers configured

### 3.4 Command Injection Prevention

**Automated Check:**

```bash
# Find shell execution
grep -rE "exec\(|spawn\(|execSync|spawnSync|child_process" --include="*.ts"

# Find eval usage
grep -rE "eval\(|Function\(|new Function" --include="*.ts" --include="*.js"
```

**Checklist:**

- [ ] No shell commands constructed with user input
- [ ] No eval() with user-controlled strings
- [ ] File paths validated and sanitized
- [ ] Environment variables don't contain user input

### 3.5 SSRF Prevention

**Automated Check:**

```bash
# Find external HTTP requests
grep -rE "fetch\(|axios\.|http\.get\(|http\.post\(|request\(" --include="*.ts" | head -20

# Find URL construction
grep -r "new URL\|url\.parse" --include="*.ts"
```

**Checklist:**

- [ ] External URLs validated against allowlist
- [ ] Internal network addresses blocked (127.0.0.1, 10.x, 192.168.x, 172.16-31.x)
- [ ] Redirect following limited or disabled
- [ ] DNS rebinding protection considered

---

## Phase 4: Cryptography & Secrets Management

### 4.1 Encryption Standards

**Required:**

| Purpose              | Algorithm            | Key Size | Notes                                |
| -------------------- | -------------------- | -------- | ------------------------------------ |
| Symmetric encryption | AES-256-GCM          | 256-bit  | Use GCM for authenticated encryption |
| Password hashing     | bcrypt/scrypt/argon2 | N/A      | Never use MD5/SHA for passwords      |
| Key derivation       | PBKDF2/scrypt        | N/A      | High iteration count                 |
| Signing              | HMAC-SHA256+         | 256-bit+ | For webhooks, tokens                 |

**Automated Check:**

```bash
# Find encryption usage
grep -rE "encrypt|decrypt|crypto|cipher" --include="*.ts" | head -20

# Find potentially weak algorithms
grep -rE "md5|sha1|des|rc4" --include="*.ts"
```

### 4.2 Secrets in Code

**Automated Check:**

```bash
# Find potential hardcoded secrets (high false positive rate)
grep -rE "(password|secret|key|token|api_key)\s*[:=]\s*['\"][^'\"]{8,}" --include="*.ts" | grep -v "process\.env\|example\|test\|mock"

# Check .env files are gitignored
cat .gitignore | grep -E "\.env|\.local"

# Find secrets in git history (run carefully)
git log -p --all -S "password" --since="3 months ago" | head -50
```

**Checklist:**

- [ ] No hardcoded API keys, tokens, or passwords
- [ ] All secrets from environment variables
- [ ] `.env` files in `.gitignore`
- [ ] No secrets committed to git history
- [ ] Secrets rotated periodically

### 4.3 Timing-Safe Comparisons

**Automated Check:**

```bash
# Find string comparisons that should be timing-safe
grep -rE "===.*secret|===.*token|===.*password|===.*hash" --include="*.ts"

# Find timing-safe comparison usage (good)
grep -r "timingSafeEqual\|constantTimeEqual" --include="*.ts"
```

**Checklist:**

- [ ] Secret comparisons use `crypto.timingSafeEqual`
- [ ] HMAC verification uses constant-time comparison
- [ ] Password hash comparison via library (bcrypt.compare)

---

## Phase 5: API & Network Security

### 5.1 CORS Configuration

**Automated Check:**

```bash
# Find CORS configuration
grep -rE "cors\(|Access-Control|origin:" --include="*.ts" | head -20
```

**Decision Tree - CORS Security:**

```
Is origin validated?
├── Allowlist of specific origins → Check list contents
│   ├── Only known frontend URLs → PASS
│   └── Wildcard (*) or dynamic → HIGH: Review carefully
├── Origin: * (wildcard) → Is credentials: true?
│   ├── YES → CRITICAL: Security vulnerability
│   └── NO → Acceptable for public APIs only
└── No CORS headers → May block legitimate requests
```

**Checklist:**

- [ ] Origin allowlist is strict (no wildcards with credentials)
- [ ] `credentials: true` only with specific origins
- [ ] Allowed methods minimal for each endpoint
- [ ] `Access-Control-Max-Age` set for caching

### 5.2 Security Headers

**Required Headers:**

| Header                      | Value                                              | Severity if Missing |
| --------------------------- | -------------------------------------------------- | ------------------- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`              | HIGH                |
| `X-Frame-Options`           | `DENY` or `SAMEORIGIN`                             | MEDIUM              |
| `X-Content-Type-Options`    | `nosniff`                                          | MEDIUM              |
| `Referrer-Policy`           | `no-referrer` or `strict-origin-when-cross-origin` | LOW                 |
| `Content-Security-Policy`   | Appropriate policy                                 | MEDIUM              |
| `Permissions-Policy`        | Deny unnecessary APIs                              | LOW                 |

### 5.3 Rate Limiting

**Checklist:**

- [ ] Global rate limit exists
- [ ] Stricter limits on authentication endpoints
- [ ] Stricter limits on expensive operations
- [ ] Rate limit headers returned (X-RateLimit-\*)
- [ ] Works in distributed environment (not just in-memory)

### 5.4 Error Response Safety

**Automated Check:**

```bash
# Find error responses that might leak info
grep -rE "err\.|error\.|stack|trace" --include="*.ts" | grep -v "test\|spec" | head -20
```

**Checklist:**

- [ ] Stack traces not exposed in production
- [ ] Internal error details not leaked
- [ ] Generic auth failure messages (prevent user enumeration)
- [ ] Request ID included for debugging

---

## Phase 6: Third-Party Integration Security

### 6.1 OAuth/Token Storage

**Checklist:**

- [ ] Access tokens encrypted at rest
- [ ] Refresh tokens encrypted at rest
- [ ] Token refresh handles errors gracefully
- [ ] Tokens have appropriate expiration
- [ ] Token revocation implemented

### 6.2 Webhook Security

**Inbound Webhooks:**

- [ ] Signature validation (HMAC) implemented
- [ ] Timestamp validation prevents replay attacks
- [ ] Webhook secrets are cryptographically random
- [ ] Failed validation logged for monitoring

**Outbound Webhooks:**

- [ ] Secrets generated with sufficient entropy
- [ ] Secrets can be rotated
- [ ] Delivery failures handled with retry
- [ ] No sensitive data in webhook payloads without encryption

### 6.3 API Key Security

**Checklist:**

- [ ] API keys generated with sufficient entropy (≥256 bits)
- [ ] Keys can be revoked
- [ ] Keys scoped to minimum necessary permissions
- [ ] Key usage is logged
- [ ] Rate limits applied per key

---

## Phase 7: Database & Data Security

### 7.1 Query Safety

**Automated Check:**

```bash
# Find ORM usage (good)
grep -rE "prisma\.|drizzle\.|sequelize\.|typeorm\." --include="*.ts" | wc -l

# Find raw SQL (needs review)
grep -rE "\.query\(|\.execute\(|sql\`" --include="*.ts" | head -10
```

**Checklist:**

- [ ] ORM used for all database operations
- [ ] Raw SQL only when necessary, always parameterized
- [ ] No dynamic table/column names from user input
- [ ] Query results typed properly

### 7.2 Mass Assignment Prevention

**Automated Check:**

```bash
# Find direct object spreading into database
grep -rE "\.create\(\{.*\.\.\.|\.insert\(\{.*\.\.\.|\.update\(\{.*\.\.\." --include="*.ts"
```

**Checklist:**

- [ ] User input validated/filtered before database operations
- [ ] Only expected fields saved to database
- [ ] Sensitive fields (role, permissions) can't be set via API
- [ ] DTOs/schemas explicitly define allowed fields

### 7.3 Data Encryption at Rest

**Checklist:**

| Data Type          | Encryption Required | Method                      |
| ------------------ | ------------------- | --------------------------- |
| Passwords          | YES                 | Hash (bcrypt/scrypt/argon2) |
| OAuth tokens       | YES                 | AES-256-GCM                 |
| API keys           | YES                 | AES-256-GCM or hash         |
| PII (if regulated) | Depends             | AES-256-GCM                 |
| Financial data     | YES                 | AES-256-GCM                 |

---

## Phase 8: Audit Report

### Severity Classification (CVSS-Style)

| Severity     | CVSS     | Criteria                                            | Response Time |
| ------------ | -------- | --------------------------------------------------- | ------------- |
| **CRITICAL** | 9.0-10.0 | Auth bypass, RCE, SQL injection, data breach        | Immediate     |
| **HIGH**     | 7.0-8.9  | XSS, IDOR, broken access control, secrets exposure  | 24-48 hours   |
| **MEDIUM**   | 4.0-6.9  | CSRF, missing headers, weak crypto, info disclosure | 1-2 weeks     |
| **LOW**      | 0.1-3.9  | Verbose errors, missing rate limits, minor leaks    | Next sprint   |

### OWASP Top 10 (2021) Mapping

| Category                       | Related Phases |
| ------------------------------ | -------------- |
| A01: Broken Access Control     | Phase 1, 2     |
| A02: Cryptographic Failures    | Phase 4        |
| A03: Injection                 | Phase 3        |
| A04: Insecure Design           | All            |
| A05: Security Misconfiguration | Phase 5        |
| A06: Vulnerable Components     | Phase 4, 6     |
| A07: Auth Failures             | Phase 1        |
| A08: Data Integrity Failures   | Phase 6        |
| A09: Logging Failures          | Phase 5        |
| A10: SSRF                      | Phase 3        |

### Report Template

```markdown
# Security Audit Report

**Date**: [DATE]
**Scope**: [FULL / TARGETED: areas]
**Application**: [Name and version]

## Executive Summary

| Severity | Count |
| -------- | ----- |
| Critical | X     |
| High     | X     |
| Medium   | X     |
| Low      | X     |

## Findings

### [SEC-001] [Finding Title]

**Severity**: CRITICAL / HIGH / MEDIUM / LOW
**OWASP**: A0X - [Category Name]
**Location**: `path/to/file.ts:line`

**Description**: [What the vulnerability is]

**Impact**: [What an attacker could achieve]

**Evidence**:
```

[Code snippet or proof]

```

**Remediation**:
```

[Fixed code or steps to fix]

```

**Verification**: [How to verify the fix works]

---

[Repeat for each finding]

## Recommendations Summary

1. [Highest priority items]
2. [Additional recommendations]

## Appendix

- Files reviewed
- Tools and commands used
- Testing methodology
```

---

## Quick Reference

### Critical Checks

```bash
# Unprotected routes
grep -rL "auth" --include="*.ts" $(find . -path "*/routes/*" -type d)

# Hardcoded secrets
grep -rE "(secret|key|password)\s*=\s*['\"]" --include="*.ts" | grep -v "env\|example"

# Raw SQL
grep -rE "query\(.*\+|execute\(.*\+" --include="*.ts"

# XSS vectors
grep -r "dangerouslySetInnerHTML" --include="*.tsx"
```

### Checklist Summary

**Authentication:**

- [ ] All user routes protected
- [ ] Secure session cookies
- [ ] OAuth uses state parameter
- [ ] Strong password hashing

**Authorization:**

- [ ] Ownership checks on all resources
- [ ] No IDOR vulnerabilities
- [ ] Role checks server-side

**Input:**

- [ ] All input validated
- [ ] No injection vectors
- [ ] XSS prevented

**Crypto:**

- [ ] Strong algorithms used
- [ ] No hardcoded secrets
- [ ] Timing-safe comparisons

**API:**

- [ ] CORS properly configured
- [ ] Security headers set
- [ ] Rate limiting enabled
- [ ] Safe error responses
