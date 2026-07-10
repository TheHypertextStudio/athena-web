CREATE TYPE "public"."sync_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('manual', 'scheduled');--> statement-breakpoint
ALTER TYPE "public"."integration_status" ADD VALUE IF NOT EXISTS 'pending' BEFORE 'connected';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'connector_sync_failed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'connector_needs_reauth';--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"status" "sync_run_status" NOT NULL,
	"trigger" "sync_trigger" NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "last_sync_status" "sync_run_status";--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "last_error_at" timestamp;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "sync_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "sync_cadence_minutes" integer DEFAULT 60;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_run_integration_idx" ON "sync_run" USING btree ("integration_id","started_at");
