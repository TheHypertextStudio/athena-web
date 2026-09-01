CREATE TYPE "public"."staff_managed_by" AS ENUM('manual', 'google_group');--> statement-breakpoint
ALTER TABLE "staff_user" ADD COLUMN "managed_by" "staff_managed_by" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_user" ADD COLUMN "groups_synced_at" timestamp;