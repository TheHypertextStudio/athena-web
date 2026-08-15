---
surfaces:
  [
    'root',
    'pricing',
    'about',
    'privacy',
    'terms',
    'problems',
    'problems-[code]',
    'sign-in',
    'sign-up',
    'recover',
    'oauth-authorize',
    'onboarding',
    'billing-return',
    'orgs-[orgId]-settings-billing',
  ]
date: 2026-08-15
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 3
  hierarchy: 3
  color: 3
  motion: 3
  states: 3
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design and copy review: public and billing surfaces — 2026-08-15

Evidence is in
[`screenshots/2026-08-15-public-copy/`](screenshots/2026-08-15-public-copy/). The set contains
1440×900 light and 390×844 dark captures for every public, auth, problem, onboarding, and anonymous
return route, plus the full four-capture set for the signed-in billing return and organization
billing settings. The authenticated captures used the repository's `dev-session.ts` and
`capture-shots.ts` tools against a migrated temporary PGlite database. The capture tool also passed
its 320px overflow check for both authenticated billing routes.

The public route pass measured `scrollWidth - clientWidth` at 320, 390, and 1440 pixels. It found a
34px marketing-header overflow at 320px. The secondary Sign in action now yields below 360px, all
visible header targets measure 40px tall, and the repeated 320px pass reports zero overflow on every
audited route. Keyboard focus on the first header link rendered a visible browser focus outline.

## Craft scorecard

| Dimension                   | Score | Evidence                                                                                                                                                                                                                              |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice   | 3     | The home page keeps Docket's exact position and follows it with one record-level fact. Product pages name Docket and Docket Pro. No generic SaaS slogans, audience labels, or product metaphors remain in the audited copy.           |
| 2. Typographic craft        | 3     | Marketing retains the Fraunces/Plex hierarchy, auth and settings retain the product token system, and identifiers such as `product_required` alone use mono.                                                                          |
| 3. Spatial rhythm & density | 3     | Removing explanatory copy shortened hero, auth, onboarding, and problem-page blocks without leaving dead containers. Product cards and billing states retain distinct factual groupings.                                              |
| 4. Hierarchy & information  | 3     | Each route has one claim or state, its consequence, then one primary action. Docket Pro price and billing unit remain adjacent.                                                                                                       |
| 5. Color discipline         | 3     | Marketing stays intentionally light under both OS schemes; auth and app surfaces use their semantic light/dark tokens. Both behaviors are screenshot-verified.                                                                        |
| 6. Motion & feedback        | 3     | The changed actions use the shared button and focus treatments. No copy change introduced motion, timed disclosure, or a state transition without an existing acknowledgement.                                                        |
| 7. States completeness      | 3     | Anonymous and signed-in route behavior is captured. Billing component tests cover free, trialing, active, past-due, canceled, and complimentary Docket Pro states; OAuth tests cover allow, deny, pending metadata, and failure copy. |
| 8. Detail craft             | 3     | Real application captures replace placeholder frames. Problem summaries no longer repeat their headings. At 320px the header keeps the primary account action without clipping, and at 390px it restores both account actions.        |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshots ✅

## Binary copy gate

Every cell is the complete binary result for that property. Mixed evidence would be
**Misaligned**; no mixed result is recorded as a pass.

### Voice

| Page             | Specificity | Directness | Confidence | Vocabulary | Reader awareness |
| ---------------- | ----------- | ---------- | ---------- | ---------- | ---------------- |
| Home             | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Pricing          | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| About            | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Privacy          | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Terms            | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Problem index    | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Problem detail   | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Sign in          | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Sign up          | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Recovery         | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| OAuth consent    | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Onboarding       | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Checkout return  | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |
| Billing settings | Aligned     | Aligned    | Aligned    | Aligned    | Aligned          |

### Character

| Page             | Point of view | Distinctiveness | Restraint | Naturalness | Honesty |
| ---------------- | ------------- | --------------- | --------- | ----------- | ------- |
| Home             | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Pricing          | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| About            | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Privacy          | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Terms            | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Problem index    | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Problem detail   | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Sign in          | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Sign up          | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Recovery         | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| OAuth consent    | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Onboarding       | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Checkout return  | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |
| Billing settings | Aligned       | Aligned         | Aligned   | Aligned     | Aligned |

### Structure

| Page             | Single purpose | Progression | Economy | Shape   | Hierarchy |
| ---------------- | -------------- | ----------- | ------- | ------- | --------- |
| Home             | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Pricing          | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| About            | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Privacy          | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Terms            | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Problem index    | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Problem detail   | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Sign in          | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Sign up          | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Recovery         | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| OAuth consent    | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Onboarding       | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Checkout return  | Aligned        | Aligned     | Aligned | Aligned | Aligned   |
| Billing settings | Aligned        | Aligned     | Aligned | Aligned | Aligned   |

## Page evidence

- **Home:** the exact pitch, one task-record sentence, factual section copy, one primary account
  action, and real application screenshots.
- **Pricing and billing:** Docket is free; Docket Pro is $8 per organization each month. Trial,
  renewal, cancellation, personal fallback, shared-workspace export, status, and management
  permission are stated beside the relevant action.
- **About:** one product sentence, The Hypertext Studio operator identity, and contact information.
- **Privacy and Terms:** substantive legal meaning is preserved while current product and monthly
  organization billing terms replace obsolete product language. Product-owner review was recorded
  on 2026-08-15; release still follows the repository's legal review requirement.
- **Problems:** each closed code now has a distinct title, consequence, and next action. No summary
  repeats the title or says to follow generic guidance.
- **Authentication and recovery:** headings carry the purpose; supporting copy appears only where
  it changes the action or recovery path.
- **OAuth consent:** the requesting client, requested access, consequence, and Allow/Deny actions
  are explicit. Authorization uses OAuth client registration, scopes, grants, and origin safety;
  no vendor allowlist appears in the product or copy.
- **Onboarding:** personal selection creates the workspace and proceeds directly to connection
  setup. Connection and passkey steps state what happens and how to skip.
- **Checkout return and billing settings:** payment confirmation remains webhook-authoritative;
  product state and the next billing action are named without promising immediate activation.

## Findings

None open. This review fixed the 320px marketing-header overflow and the duplicated public problem
summaries before recording the final all-Aligned gate.
