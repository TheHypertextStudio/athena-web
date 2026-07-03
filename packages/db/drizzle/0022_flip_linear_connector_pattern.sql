-- Data migration: Linear graduates from a one-time `migration` (Import) to a live
-- `connector` (Connections) — see PROVIDER_DIRECTORY.linear in
-- apps/api/src/routes/integration-provider.ts. No schema change: `integration_pattern`
-- already has both enum values; this backfills existing rows to match the new directory
-- entry so already-connected Linear integrations read consistently with freshly-connected
-- ones (both `connector`).
UPDATE "integration" SET "pattern" = 'connector' WHERE "provider" = 'linear';
