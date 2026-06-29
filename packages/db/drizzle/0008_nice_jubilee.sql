CREATE TYPE "public"."daily_digest_status" AS ENUM('pending', 'generating', 'generated', 'sent', 'failed', 'skipped_empty');--> statement-breakpoint
CREATE TYPE "public"."event_subscription_status" AS ENUM('active', 'expired', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "public"."inbound_event_status" AS ENUM('received', 'processing', 'processed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."observation_kind" AS ENUM('message', 'mention', 'assignment', 'status_change', 'comment', 'reaction', 'created', 'completed', 'calendar_invite', 'calendar_update', 'task_assignment');--> statement-breakpoint
CREATE TABLE "daily_digest" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"digest_date" date NOT NULL,
	"status" "daily_digest_status" DEFAULT 'pending' NOT NULL,
	"summary_markdown" text,
	"summary_html" text,
	"stats" jsonb,
	"observation_count" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp,
	"sent_at" timestamp,
	"delivery_message_id" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"integration_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_subscription_id" text,
	"ingest_token" text,
	"status" "event_subscription_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp,
	"cursor" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"integration_id" text,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"status" "inbound_event_status" DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"processing_started_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "observation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"user_id" text,
	"integration_id" text,
	"provider" text NOT NULL,
	"kind" "observation_kind" NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"permalink" text,
	"external_actor" jsonb,
	"subject" jsonb,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_event_id" text,
	"external_id" text,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_subscription" ADD CONSTRAINT "event_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_subscription" ADD CONSTRAINT "event_subscription_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_subscription" ADD CONSTRAINT "event_subscription_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event" ADD CONSTRAINT "inbound_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event" ADD CONSTRAINT "inbound_event_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_source_event_id_inbound_event_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."inbound_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_digest_user_date_uq" ON "daily_digest" USING btree ("user_id","digest_date");--> statement-breakpoint
CREATE INDEX "event_subscription_integration_idx" ON "event_subscription" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "event_subscription_expiry_idx" ON "event_subscription" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_event_provider_external_uq" ON "inbound_event" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "inbound_event_status_idx" ON "inbound_event" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "observation_org_user_occurred_idx" ON "observation" USING btree ("organization_id","user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_org_dedupe_uq" ON "observation" USING btree ("organization_id","dedupe_key");