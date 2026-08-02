# Verification log

**GEN-09** — "Each work slice's record names the verification subagent that checked it and includes at
least one verification artifact produced by that subagent rather than the implementer (screenshot,
test output, or prod HTTP trace)."

The rule this log follows: **the implementer's own green test run is not verification.** An artifact
counts only if a different agent produced it. Where no verifier has run yet, the entry says PENDING
and records the exact command that will produce the artifact — it never invents verifier output.

Entry format:

```
### <slice-id>
- **Verification subagent:** <name, or PENDING>
- **Artifact produced by the verifier:** <path on disk, or the command that will produce it>
- **Verdict:** <what the verifier concluded>
- **Status:** VERIFIED | PENDING
```

---

## Status summary

| Slice                  | Verifier                      | Artifact on disk | Status   |
| ---------------------- | ----------------------------- | ---------------- | -------- |
| `ci-gating`            | production-verification agent | yes (6 files)    | VERIFIED |
| `test-standards`       | credential-masking probe      | yes (9 files)    | VERIFIED |
| `launch-governance`    | launch-record-reconciler      | yes (1 file)     | VERIFIED |
| `security-and-domains` | launch-ledger-integrator      | yes (1 file)     | VERIFIED |

**4 of 4 slices carry a verifier-produced artifact**, and each names its verifier in its own
frontmatter (`verifier:` / `verifierArtifacts:`) rather than only here — which is what GEN-09's
acceptance actually asks for. `scripts/launch-record.ts` now _requires_ both fields to parse a
slice, rejects a verifier that normalizes to the implementing slice's own name, and refuses to
grade any requirement `closed` unless its slice cites an artifact that exists on disk under a
verifier-owned evidence root. The rule is enforced by the parser, not by this document.

---

### `ci-gating`

- **Verification subagent:** the lane's production-verification agent, which runs
  `scripts/production-verify.ts` and `scripts/secret-scan.ts` independently of the CI implementer.
- **Artifacts produced by the verifier** — all present on disk, none written by this worker:

  ```
  $ ls docs/engineering/launch/evidence/production/
  2026-08-02-scr20-forced-failure.txt
  2026-08-02-secret-sweep.txt
  2026-08-02-turbo-cache.txt
  2026-08-02-turbo-remote-cache.txt
  2026-08-02T10-05-46-131Z-production-verify.json
  2026-08-02T10-05-46-131Z-production-verify.txt
  ```

- **Verdict (quoted from the artifact, not paraphrased):**

  ```
  # Production verification — 2026-08-02T10:05:46.131Z
  ## Freshness: is production serving current code?
    production   https://docket-api.hypertext.studio  →  204 OpenAPI paths
    local (HEAD) http://…api.docket.localhost:1355     →  236 OpenAPI paths
    verdict: STALE — 32 path(s) built locally are not deployed
  ```

  A negative finding produced by someone other than the implementer is exactly what this requirement
  is for: production is serving code 32 API paths behind `HEAD`, which no self-report would have
  surfaced.

- **Status:** VERIFIED. The slice file `docs/engineering/launch/slices/ci-gating.md` is on disk and
  its own `verification` field records the same run
  (`pnpm exec tsx scripts/production-verify.ts — FAIL, exit 1 (production 32 paths behind HEAD)`),
  which matches the artifact rather than contradicting it.

---

### `test-standards`

- **Verification subagent:** the lane's credential-masking probe, which drives the connector
  add/store flow against the running dev stack and records both the DOM state and every network
  response.
- **Artifacts produced by the verifier** — nine files, none written by this worker:

  ```
  $ ls docs/design/audits/screenshots/2026-08-02-credential-masking/
  connector-bearer-1440x900-dark.png    stored-connector-1440x900-dark.png
  connector-bearer-1440x900-light.png   stored-connector-1440x900-light.png
  connector-bearer-390x844-dark.png     stored-connector-390x844-dark.png
  connector-bearer-390x844-light.png    stored-connector-390x844-light.png
  probe-report.json
  ```

  Two widths (1440×900 and 390×844) in both themes, plus a 138 KB machine-readable report.

- **Verdict (quoted from `probe-report.json`, not paraphrased):**

  ```json
  {
    "bearerFieldMasked": true,
    "bearerFieldType": "password",
    "bearerStoreOutcome": "rejected: Could not connect that server.",
    "capturedAt": "2026-08-02T10:10:50.840Z",
    "leakingResponses": []
  }
  ```

- **The PNGs were read, not merely captured.** `connector-bearer-1440x900-light.png` shows the
  Settings → Athena "Add a connector" dialog with the **Bearer token** field rendering as filled
  dots — the credential is masked in the surface a screenshot would leak it from. The acceptance is
  visual, and a capture nobody looked at is not evidence.
- **Status:** VERIFIED, with one caveat recorded rather than glossed: the `test-standards` **slice
  file** is not yet on disk (`ls docs/engineering/launch/slices/` → `ci-gating.md`,
  `launch-governance.md`). The artifacts exist and are sound; the slice record that should cite them
  does not, so the reconciler currently counts every `test-standards` requirement as unclaimed.

---

### `launch-governance`

- **Verification subagent:** `launch-record-reconciler` — an agent that wrote none of the slices in
  this log. It ran the commands this entry had specified, and reports below.
- **Artifact produced by the verifier:**
  `docs/engineering/launch/evidence/verification/2026-08-02-launch-record-reconciliation.txt`.
  Ten sections of captured output, exit codes included.
- **Verdict (findings, not a summary — the negative ones first):**

  | Requirement  | Finding                                                                                                                                                                                                                                                                                                  |
  | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GEN-01       | Demoted to `partial`. The checklist is real and idempotent, but 385 of 399 ids map to no landed commit, and nothing this lane produced is committed.                                                                                                                                                     |
  | GEN-08       | Demoted to `partial`. Its evidence read "This slice asked none, so the array is empty" while the same file holds Q-01/WIL-41; and the acceptance is conditioned on a sign-off that has not happened.                                                                                                     |
  | SCR-22       | Demoted to `partial`. Discovery re-verified at 25 files / 42 tests, but the suite has never been run green.                                                                                                                                                                                              |
  | MISS-07      | Demoted to `in-progress` in the record, which had graded it `closed` while this slice claimed `partial`.                                                                                                                                                                                                 |
  | GEN-09       | The seven entries reading owner `launch-governance` / verifiedBy `launch-governance-verifier` were self-verification passing a string-equality guard on a naming convention. The guard now normalizes the `-verifier` family of suffixes, and requires an artifact under a verifier-owned evidence root. |
  | SCR-18       | Two registers disagreed on 7 specs, each with its own passing guard. One register survives, and the guard now rejects a second.                                                                                                                                                                          |
  | SCR-19       | Holds. `pnpm ci:gate-policy` exit 0, `deploy-production.needs` covers all six check jobs.                                                                                                                                                                                                                |
  | SCR-20       | Static half holds; the empirical half is unproven and needs a GitHub Actions run this agent cannot produce without pushing.                                                                                                                                                                              |
  | GEN-18       | Holds. Both negative searches reproduce with counts matching the document line for line.                                                                                                                                                                                                                 |
  | MISS-01      | Holds. All five voice-mode hits are in one generated Cloudflare type declaration, as claimed.                                                                                                                                                                                                            |
  | GEN-03/04/05 | Hold. Re-verified; only the verifier name and artifacts changed.                                                                                                                                                                                                                                         |

  A verification that agreed with everything would not be worth reading. Six of these findings moved
  a requirement backwards.

- **Status:** VERIFIED.

---

### `security-and-domains`

- **Verification subagent:** `launch-ledger-integrator` — the agent that collapsed the two launch
  ledgers into one. It wrote neither `docs/engineering/domains.md` nor the credential-masking work,
  and it re-ran the availability probes rather than reading them out of the document.
- **Artifact produced by the verifier:**
  `docs/engineering/launch/evidence/verification/2026-08-02-security-and-domains-verification.txt`.
- **Verdict:**
  - **GEN-23 holds.** 20 Docket and 16 Athena candidate rows, each with registrar/WHOIS or DNS
    evidence, and one recommended pick per product with rationale (`docket.place`, `athena.day`).
    Both picks independently re-probe `status: NXDOMAIN` from this machine, and two of the `.com`
    rows marked free re-probe `No match for domain` at the Verisign registry — the document's
    availability claims reproduce rather than merely being asserted.
  - **GEN-07 holds for the UI and API-response clauses.** `probe-report.json` records
    `bearerFieldMasked: true`, `bearerFieldType: "password"`, `leakingResponses: []`, and zero of
    the captured responses containing the probe token. The PNGs were read, not counted:
    `connector-bearer-1440x900-light.png` shows the Bearer token field as filled dots, and
    `stored-connector-1440x900-light.png` shows a _stored_ connector's expanded "Connection
    details" rendering the server URL and no credential at all — stronger than the "last-4 only"
    the acceptance would have accepted.
  - **Residual, recorded rather than glossed:** the acceptance also names "server logs for the same
    session contain no key material". The probe captures HTTP responses and DOM, not API stdout, so
    that clause rests on the `sealCredential()` code path rather than on a captured log sweep.
- **Status:** VERIFIED.

---

## The state of GEN-09

All three slices now carry an artifact produced by an agent other than the implementer, and all
three sets of artifacts contain **negative** findings — production 32 API paths behind `HEAD`, a
bearer-token store that was rejected, and the six demotions above. That is the strongest available
sign the verification is real, since none of them is a result an implementer would self-report.

The rule itself changed in the same pass, because the old one could not see the evasion this log was
written to prevent. `verificationViolations()` in
`packages/test-utils/tests/launch-policies/launch-record-schema.ts` now rejects a closed entry when:

1. `verifiedBy` and `owner` normalize to the same identity — casing, separators, and a trailing
   `-verifier` / `-verification` / `-verify` / `-reviewer` / `-review` / `-checker` are stripped
   before comparing, and containment counts, so `launch-governance-verifier` no longer passes as an
   independent check on `launch-governance`; or
2. every artifact it cites sits outside `docs/engineering/launch/evidence/` and
   `docs/design/audits/screenshots/` — the roots only a verifier writes to. Citing the launch record
   and the policy test that reads it, both written by the implementer, is what the seven entries did.

Both rules are proved against fixtures in both directions, so neither is satisfied only by the
record as it happens to stand today.
