# Public copy audit — 2026-08-11

Surfaces: home, pricing, about, privacy, terms, problem catalog, sign-in, sign-up, recovery,
OAuth consent, onboarding, checkout return, and organization billing settings.

Screenshots: `docs/design/audits/assets/2026-08-11-public-copy/` contains 52 captures: every
surface at 1440×900 and 390×844 in light and dark OS color schemes. Marketing intentionally keeps
its paper register under a dark OS setting; app and authentication surfaces use their dark theme.
Authenticated captures use a disposable local PGlite account. The OAuth capture uses a populated,
signed-query-shaped request and the local authenticated session; no grant was submitted.

## Binary copy gate

`A` means **Aligned**. Any mixed evidence would be recorded as `M` for **Misaligned** and would fail
the page. No property receives a partial score.

### Voice

| Page             | Specificity | Directness | Confidence | Vocabulary | Reader awareness |
| ---------------- | ----------- | ---------- | ---------- | ---------- | ---------------- |
| Home             | A           | A          | A          | A          | A                |
| Pricing          | A           | A          | A          | A          | A                |
| About            | A           | A          | A          | A          | A                |
| Privacy          | A           | A          | A          | A          | A                |
| Terms            | A           | A          | A          | A          | A                |
| Problems         | A           | A          | A          | A          | A                |
| Sign-in          | A           | A          | A          | A          | A                |
| Sign-up          | A           | A          | A          | A          | A                |
| Recovery         | A           | A          | A          | A          | A                |
| OAuth consent    | A           | A          | A          | A          | A                |
| Onboarding       | A           | A          | A          | A          | A                |
| Checkout return  | A           | A          | A          | A          | A                |
| Billing settings | A           | A          | A          | A          | A                |

### Character

| Page             | Point of view | Distinctiveness | Restraint | Naturalness | Honesty |
| ---------------- | ------------- | --------------- | --------- | ----------- | ------- |
| Home             | A             | A               | A         | A           | A       |
| Pricing          | A             | A               | A         | A           | A       |
| About            | A             | A               | A         | A           | A       |
| Privacy          | A             | A               | A         | A           | A       |
| Terms            | A             | A               | A         | A           | A       |
| Problems         | A             | A               | A         | A           | A       |
| Sign-in          | A             | A               | A         | A           | A       |
| Sign-up          | A             | A               | A         | A           | A       |
| Recovery         | A             | A               | A         | A           | A       |
| OAuth consent    | A             | A               | A         | A           | A       |
| Onboarding       | A             | A               | A         | A           | A       |
| Checkout return  | A             | A               | A         | A           | A       |
| Billing settings | A             | A               | A         | A           | A       |

### Structure

| Page             | Single purpose | Progression | Economy | Shape | Hierarchy |
| ---------------- | -------------- | ----------- | ------- | ----- | --------- |
| Home             | A              | A           | A       | A     | A         |
| Pricing          | A              | A           | A       | A     | A         |
| About            | A              | A           | A       | A     | A         |
| Privacy          | A              | A           | A       | A     | A         |
| Terms            | A              | A           | A       | A     | A         |
| Problems         | A              | A           | A       | A     | A         |
| Sign-in          | A              | A           | A       | A     | A         |
| Sign-up          | A              | A           | A       | A     | A         |
| Recovery         | A              | A           | A       | A     | A         |
| OAuth consent    | A              | A           | A       | A     | A         |
| Onboarding       | A              | A           | A       | A     | A         |
| Checkout return  | A              | A           | A       | A     | A         |
| Billing settings | A              | A           | A       | A     | A         |

Verdict: **all 13 pages pass all 15 copy properties.**

## Evidence by page

| Page             | Evidence                                                                                                                                                                                          | Captures                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home             | Uses the approved positioning once, the approved task sentence once, one factual sentence per section, and no signed-in aside, competitor history, hypothetical story, or hero agent explanation. | [desktop](assets/2026-08-11-public-copy/home-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/home-mobile-light.png)                         |
| Pricing          | Names Docket and Docket Pro as products; states the $8 organization-month billing unit, first 14-day trial, renewal, cancellation, personal fallback, and shared export behavior.                 | [desktop](assets/2026-08-11-public-copy/pricing-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/pricing-mobile-light.png)                   |
| About            | Contains one product sentence, The Hypertext Studio's operator identity, and contact information.                                                                                                 | [desktop](assets/2026-08-11-public-copy/about-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/about-mobile-light.png)                       |
| Privacy          | Preserves the legal disclosure structure and uses current Docket terminology without marketing claims.                                                                                            | [desktop](assets/2026-08-11-public-copy/privacy-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/privacy-mobile-light.png)                   |
| Terms            | Preserves substantive terms and adds only the implemented monthly organization billing, renewal, cancellation, personal fallback, and shared export mechanics.                                    | [desktop](assets/2026-08-11-public-copy/terms-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/terms-mobile-light.png)                       |
| Problems         | Each stable Problem code names the state, consequence, and next action; generic recovery filler is removed.                                                                                       | [desktop](assets/2026-08-11-public-copy/problems-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/problems-mobile-light.png)                 |
| Sign-in          | The title and primary action stand alone; supporting links describe distinct recovery and account-creation actions.                                                                               | [desktop](assets/2026-08-11-public-copy/sign-in-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/sign-in-mobile-light.png)                   |
| Sign-up          | Labels and the primary action describe the requested account information without repeating the title.                                                                                             | [desktop](assets/2026-08-11-public-copy/sign-up-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/sign-up-mobile-light.png)                   |
| Recovery         | Names the email and recovery code required for this specific recovery action.                                                                                                                     | [desktop](assets/2026-08-11-public-copy/recovery-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/recovery-mobile-light.png)                 |
| OAuth consent    | Names the requesting client, account, return host, readable permissions, allow consequence, deny consequence, and two explicit actions.                                                           | [desktop](assets/2026-08-11-public-copy/oauth-consent-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/oauth-consent-mobile-light.png)       |
| Onboarding       | Moves from intent directly to connection setup, explains imported records and source relationships, and states passkey setup and skip without persuasion.                                         | [desktop](assets/2026-08-11-public-copy/onboarding-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/onboarding-mobile-light.png)             |
| Checkout return  | States that Stripe confirmation controls Docket Pro availability and points to current billing status without implying that the redirect granted access.                                          | [desktop](assets/2026-08-11-public-copy/checkout-return-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/checkout-return-mobile-light.png)   |
| Billing settings | Separates free Docket from Docket Pro, shows the organization billing unit and current state, explains cancellation for the current organization kind, and presents one state-appropriate action. | [desktop](assets/2026-08-11-public-copy/billing-settings-desktop-light.png) · [mobile](assets/2026-08-11-public-copy/billing-settings-mobile-light.png) |

The automated copy gate also enforces one approved positioning occurrence, the approved subtitle,
removal of `personal-welcome`, and absence of known generated-copy phrases.

## Craft scorecard

This review changed copy and copy-driven layout only. Scores describe the rendered surfaces, not a
separate visual redesign.

| Dimension                         | Score | Evidence                                                                                                                            |
| --------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | Marketing keeps the paper-and-ink register; app surfaces use the product register; every audited sentence is specific.              |
| 2. Typographic craft              | 3     | Headings, body copy, labels, and billing figures keep a clear hierarchy at both widths.                                             |
| 3. Spatial rhythm & density       | 3     | Sections, legal prose, auth cards, and settings rows preserve one readable rhythm after copy removal.                               |
| 4. Hierarchy & information design | 3     | Each surface has one obvious purpose and one primary next action.                                                                   |
| 5. Color discipline               | 3     | Marketing stays neutral with the existing ink/paper palette; app surfaces use semantic theme tokens in both themes.                 |
| 6. Motion & feedback              | 3     | Existing shared controls retain their standard hover, focus, loading, and reduced-motion behavior; this copy change adds no motion. |
| 7. States completeness            | 3     | Error, recovery, canceled checkout, product-status, and malformed OAuth states each give a specific next action.                    |
| 8. Detail craft                   | 3     | Desktop and mobile captures show intentional wrapping and no horizontal overflow in the audited copy.                               |

Hard gates: A11y **not re-certified by this copy audit** · Responsive ✅ · Theme parity ✅ · No
placeholder ✅ · Screenshot-verified ✅.

The dashed product-image frames present during the copy-only review were replaced with nine
captures of Docket using disclosed example data. The follow-up
[`2026-08-11-marketing-release.md`](2026-08-11-marketing-release.md) audit verifies the resulting
desktop and mobile layouts and records the complete marketing craft gate.

## Release gates

- Production Docket Pro checkout, signed-webhook activation, capability access, billing management,
  cancellation, return routing, and no-duplicate-trial behavior are not proven by local renders.
  Revised pricing copy must remain unpublished until that live path passes.
- Privacy and terms changes require operator and legal review before release.
