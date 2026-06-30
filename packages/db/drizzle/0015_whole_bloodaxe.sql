-- Refactor the ambient `observation` substrate into the canonical cross-tool `event` model.
-- The feature is unreleased, so the old observation tables are dropped and recreated rather
-- than transformed (no data to preserve). `stream_relevance` / `summary_cadence` are kept.
DROP TABLE IF EXISTS "observation_recipient" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "observation" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "stream_subscription" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."observation_kind";--> statement-breakpoint
CREATE TYPE "public"."canonical_entity_kind" AS ENUM('work_item', 'project', 'program', 'initiative', 'cycle', 'thread', 'message', 'document', 'calendar_event', 'person', 'organization');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('message', 'mention', 'assignment', 'status_change', 'comment', 'reaction', 'created', 'completed', 'calendar_invite', 'calendar_update', 'task_assignment');--> statement-breakpoint
CREATE TYPE "public"."source_system" AS ENUM('docket', 'linear', 'github', 'slack', 'google_calendar', 'gmail');--> statement-breakpoint
ALTER TABLE "daily_digest" RENAME COLUMN "observation_count" TO "event_count";--> statement-breakpoint
CREATE TABLE "event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"user_id" text,
	"source_system" "source_system" NOT NULL,
	"integration_id" text,
	"external_url" text,
	"kind" "event_kind" NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"permalink" text,
	"actor" jsonb,
	"entity" jsonb,
	"entity_kind" "canonical_entity_kind",
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detail" jsonb,
	"source_event_id" text,
	"external_id" text,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_recipient" (
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"reason" "stream_relevance" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_recipient_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "stream_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"user_id" text NOT NULL,
	"entity_kind" "canonical_entity_kind" NOT NULL,
	"source" "source_system" NOT NULL,
	"external_id" text NOT NULL,
	"muted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_source_event_id_inbound_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."inbound_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_recipient" ADD CONSTRAINT "event_recipient_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_recipient" ADD CONSTRAINT "event_recipient_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_subscription" ADD CONSTRAINT "stream_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_subscription" ADD CONSTRAINT "stream_subscription_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_org_user_occurred_idx" ON "event" USING btree ("organization_id","user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_user_occurred_idx" ON "event" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_org_occurred_idx" ON "event" USING btree ("organization_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "event_org_entitykind_occurred_idx" ON "event" USING btree ("organization_id","entity_kind","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_org_dedupe_uq" ON "event" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "event_recipient_user_occurred_idx" ON "event_recipient" USING btree ("user_id","occurred_at","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stream_subscription_user_entity_uq" ON "stream_subscription" USING btree ("user_id","entity_kind","source","external_id");--> statement-breakpoint
CREATE INDEX "stream_subscription_entity_idx" ON "stream_subscription" USING btree ("entity_kind","source","external_id");
