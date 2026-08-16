ALTER TABLE "integration" ADD COLUMN "last_error_kind" text;--> statement-breakpoint
ALTER TABLE "sync_run" ADD COLUMN "error_kind" text;