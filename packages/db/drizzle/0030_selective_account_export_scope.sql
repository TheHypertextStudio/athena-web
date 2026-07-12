ALTER TABLE "account_export" ADD COLUMN IF NOT EXISTS "scope" jsonb;--> statement-breakpoint
ALTER TABLE "account_export" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'manual' NOT NULL;
