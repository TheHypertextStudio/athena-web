ALTER TABLE "integration" ADD COLUMN "write_back" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "external_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "external_etag" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "external_list_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "last_pushed_at" timestamp;--> statement-breakpoint
-- Backfill: existing Google Tasks connectors become two-way (write-back) so they round-trip
-- going forward. Their next sync will attempt a push; accounts still holding the old
-- `tasks.readonly` scope surface as needs-reauth (never silent) until reconnected.
UPDATE "integration" SET "write_back" = true WHERE "provider" = 'gtasks';