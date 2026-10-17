# Upstream provenance

Protocol routes and the R2 storage adapter derive from
[AdiRishi/turborepo-remote-cache-cloudflare](https://github.com/AdiRishi/turborepo-remote-cache-cloudflare/tree/b0aaab5c3063dd5f8d15e38e69398a0c040edcda),
commit `b0aaab5c3063dd5f8d15e38e69398a0c040edcda` (upstream package version 4.0.0).
The upstream MIT license is preserved in `UPSTREAM-LICENSE`.

The upstream project is a deployable private package with no supported library exports.
The source is vendored so dependency and protocol updates can be reviewed normally.

Studio adaptations:

- Google OIDC authentication replaces the static bearer secret; a registered service-account
  numeric subject and the exact audience are mandatory. GitHub Actions continues using WIF.
- Each verified Google identity maps to one unique registered namespace. Request-scoped Hono context
  selects its R2 prefix; cross-client GET/PUT requests are denied before storage access. Artifact IDs
  cannot contain path separators.
- Signed artifact tags are required on upload and missing tags are treated as cache misses.
- R2 reads and writes stream directly. The optional edge Cache API layer is removed, avoiding
  cloned response-body buffering and intermediary caching of private build artifacts.
- Native R2 lifecycle rules replace cleanup cron code. Internal maintenance and test routes,
  KV storage, CORS and public application HTML are omitted.
- Worker bindings are generated from native cf configuration. Shared binding objects are never mutated.
- Provider failures return a generic retryable response without storage details or credentials.

Artifact authenticity remains Turbo's client-side HMAC verification. The Worker retains opaque tags
in R2 object metadata and returns them; it has no artifact-signing secret or R2 API credential.
