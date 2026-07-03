CREATE TYPE "public"."sync_run_purpose" AS ENUM('task_sync', 'email_ingest');--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'outlook';--> statement-breakpoint
ALTER TABLE "email_suggestion" ADD COLUMN "rfc822_message_id" text;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_run" ADD COLUMN "purpose" "sync_run_purpose" DEFAULT 'task_sync' NOT NULL;--> statement-breakpoint
CREATE INDEX "email_suggestion_org_message_id_idx" ON "email_suggestion" USING btree ("organization_id","rfc822_message_id");--> statement-breakpoint
-- Backfill: existing gmail suggestions predate provider-captured URLs; stamp the canonical
-- Gmail deep link into email_meta.externalUrl so the app layer never fabricates URLs at
-- read time (new ingests capture the URL from the provider at listing time).
UPDATE "email_suggestion" es
SET "email_meta" = coalesce(es."email_meta", '{}'::jsonb)
  || jsonb_build_object('externalUrl', 'https://mail.google.com/mail/#all/' || es."external_thread_id")
FROM "integration" i
WHERE i."id" = es."integration_id"
  AND i."provider" = 'gmail'
  AND (es."email_meta" IS NULL OR es."email_meta"->>'externalUrl' IS NULL);
