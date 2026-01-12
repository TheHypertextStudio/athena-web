-- Migration: Multi-account support for calendar and third-party integrations
-- Allows users to connect multiple accounts from the same provider (e.g., work + personal Google accounts)

-- Add new columns to linked_integrations for multi-account support
ALTER TABLE "linked_integrations" ADD COLUMN "account_label" varchar(100);--> statement-breakpoint
ALTER TABLE "linked_integrations" ADD COLUMN "account_email" varchar(255);--> statement-breakpoint
ALTER TABLE "linked_integrations" ADD COLUMN "account_color" text;--> statement-breakpoint
ALTER TABLE "linked_integrations" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "linked_integrations" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Add unique constraint to prevent connecting the same external account twice
-- This replaces any implicit assumption of 1:1 user-provider relationship
CREATE UNIQUE INDEX "linked_integrations_user_provider_external_idx" ON "linked_integrations" ("user_id", "provider", "external_account_id");--> statement-breakpoint

-- Set existing connections as primary (migration for existing users)
UPDATE "linked_integrations" SET "is_primary" = true WHERE "id" IN (
  SELECT DISTINCT ON ("user_id", "provider") "id"
  FROM "linked_integrations"
  ORDER BY "user_id", "provider", "created_at" ASC
);--> statement-breakpoint

-- Add index for efficient queries by user and provider
CREATE INDEX "linked_integrations_user_provider_idx" ON "linked_integrations" ("user_id", "provider");--> statement-breakpoint

-- Add index for ordering by display_order
CREATE INDEX "linked_integrations_display_order_idx" ON "linked_integrations" ("user_id", "display_order");
