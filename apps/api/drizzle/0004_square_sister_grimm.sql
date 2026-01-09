CREATE TYPE "public"."entity_type" AS ENUM('task', 'project', 'event', 'activity', 'initiative');--> statement-breakpoint
CREATE TYPE "public"."sync_direction" AS ENUM('inbound', 'outbound', 'bidirectional');--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'todoist' BEFORE 'google_calendar';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'asana' BEFORE 'google_calendar';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'jira' BEFORE 'google_calendar';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'trello' BEFORE 'google_calendar';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'slack';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'zoom';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'google_drive';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'dropbox';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'figma';--> statement-breakpoint
CREATE TABLE "agenda_task_order" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agenda_date" timestamp NOT NULL,
	"task_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_id_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"local_entity_id" text NOT NULL,
	"external_id" text NOT NULL,
	"sync_direction" "sync_direction" DEFAULT 'bidirectional' NOT NULL,
	"last_synced_from_external" timestamp,
	"last_synced_to_external" timestamp,
	"external_version" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "google_sign_in_disabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "tokens_revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "credential_change_required" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "security_alert_at" timestamp;--> statement-breakpoint
ALTER TABLE "agenda_task_order" ADD CONSTRAINT "agenda_task_order_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_task_order" ADD CONSTRAINT "agenda_task_order_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_id_mappings" ADD CONSTRAINT "external_id_mappings_integration_id_linked_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."linked_integrations"("id") ON DELETE cascade ON UPDATE no action;