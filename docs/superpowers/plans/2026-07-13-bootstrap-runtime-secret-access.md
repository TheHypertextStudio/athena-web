# Bootstrap Runtime Secret Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every API secret created by bootstrap is readable by the Cloud Run runtime identity before deployment.

**Architecture:** Reuse the integrations setup module as the single place that builds the default Cloud Run runtime service-account binding. Bootstrap calls that helper after it creates or reuses each base secret; integrations continues calling it after provider-secret writes. The scope remains one Secret Manager secret at a time.

**Tech Stack:** TypeScript, Node child-process APIs, gcloud Secret Manager IAM, Vitest.

## Global Constraints

- Bind only `roles/secretmanager.secretAccessor` on an individual secret.
- Do not expose secret payloads in output, arguments, tests, or documentation.
- Preserve idempotent bootstrap and integration reruns.

---

### Task 1: Reconcile runtime access for bootstrap secrets

**Files:**

- Modify: `scripts/integrations-setup.ts: pushSecret permission block`
- Modify: `scripts/bootstrap.ts: setupGcp Secret Manager loop`
- Modify: `tests/tooling/bootstrap-setup.test.ts: production Secret Manager bindings`
- Modify: `docs/engineering/deployment.md: One-time bootstrap`
- Modify: `docs/WORKLOG.md`

**Interfaces:**

- Produces: `ensureRuntimeSecretAccess(project: string, secretName: string): void`.
- Consumes: `gcloud projects describe` for the project number and `gcloud secrets add-iam-policy-binding` for the secret-level role grant.

- [x] **Step 1: Write the failing regression test**

```ts
expect(bootstrapSource).toContain('ensureRuntimeSecretAccess(cfg.project, name)');
expect(runtimeSecretAccessorBindingArgs('123', 'docket-auth-secret', 'project')).toEqual([
  'secrets',
  'add-iam-policy-binding',
  'docket-auth-secret',
  '--project=project',
  '--member=serviceAccount:123-compute@developer.gserviceaccount.com',
  '--role=roles/secretmanager.secretAccessor',
  '--quiet',
]);
```

- [x] **Step 2: Run the targeted test and verify it fails**

Run: `pnpm vitest run tests/tooling/bootstrap-setup.test.ts`

Expected: FAIL because bootstrap does not reconcile runtime access for its base secrets.

- [x] **Step 3: Implement the smallest shared helper and wire bootstrap to it**

```ts
export function ensureRuntimeSecretAccess(project: string, secretName: string): void {
  const projectNumber = tryRun(
    `gcloud projects describe ${project} --format='value(projectNumber)'`,
  );
  if (!projectNumber) throw new Error(`Could not resolve the project number for ${project}`);
  execFileSync('gcloud', runtimeSecretAccessorBindingArgs(projectNumber, secretName, project), {
    stdio: 'inherit',
  });
}
```

Call it from `pushSecret` and after each bootstrap secret is created or reused.

- [x] **Step 4: Run the targeted test and verify it passes**

Run: `pnpm vitest run tests/tooling/bootstrap-setup.test.ts`

Expected: PASS with no secret values printed.

- [x] **Step 5: Run focused static checks and commit**

Run: `pnpm prettier --check scripts/bootstrap.ts scripts/integrations-setup.ts tests/tooling/bootstrap-setup.test.ts docs/engineering/deployment.md docs/WORKLOG.md docs/superpowers/plans/2026-07-13-bootstrap-runtime-secret-access.md`

Commit the five implementation, test, and documentation files with the repository's atomic staging chain.
