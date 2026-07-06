CREATE TYPE "public"."contact_point_status" AS ENUM('pending', 'active', 'disabled', 'bounced', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."contact_point_type" AS ENUM('email', 'phone', 'push_token');--> statement-breakpoint
CREATE TYPE "public"."external_actor_match" AS ENUM('email', 'manual');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('security', 'account', 'service_announcement', 'workflow', 'digest', 'billing', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('web', 'email', 'sms', 'push');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('suppressed', 'queued', 'sent', 'delivered', 'read', 'acted', 'failed', 'bounced', 'complained');--> statement-breakpoint
CREATE TYPE "public"."notification_destination_type" AS ENUM('in_app', 'email', 'phone', 'push_token');--> statement-breakpoint
CREATE TYPE "public"."notification_inbound_event_kind" AS ENUM('delivered', 'opened', 'clicked', 'bounced', 'complained', 'replied', 'unsubscribed', 'action');--> statement-breakpoint
CREATE TYPE "public"."notification_intent_status" AS ENUM('draft', 'scheduled', 'queued', 'sending', 'sent', 'partially_failed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."notification_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."notification_recipient_reason" AS ENUM('explicit', 'org_member', 'segment_match', 'owner', 'assignee');--> statement-breakpoint
CREATE TYPE "public"."notification_reply_policy" AS ENUM('none', 'staff_inbox', 'org_admins', 'automation');--> statement-breakpoint
CREATE TYPE "public"."notification_sender_type" AS ENUM('system', 'staff', 'org', 'automation');--> statement-breakpoint
CREATE TYPE "public"."notification_suppression_reason" AS ENUM('user_disabled_channel', 'quiet_hours', 'no_verified_contact_point', 'contact_point_bounced', 'user_unsubscribed', 'category_disallows_channel', 'staff_approval_missing', 'duplicate_idempotency_key', 'legal_suppression');--> statement-breakpoint
CREATE TYPE "public"."sync_run_purpose" AS ENUM('task_sync', 'email_ingest');--> statement-breakpoint
ALTER TYPE "public"."attachment_kind" ADD VALUE 'file';--> statement-breakpoint
ALTER TYPE "public"."email_suggestion_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'automation';--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'discord' BEFORE 'google_calendar';--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'outlook';--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text,
	"count" integer,
	"last_request" bigint
);
--> statement-breakpoint
CREATE TABLE "contact_point" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "contact_point_type" NOT NULL,
	"value" text NOT NULL,
	"value_normalized" text NOT NULL,
	"value_masked" text NOT NULL,
	"status" "contact_point_status" DEFAULT 'pending' NOT NULL,
	"primary" boolean DEFAULT false NOT NULL,
	"verification_code_hash" text,
	"verified_at" timestamp,
	"disabled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_actor" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"external_id" text NOT NULL,
	"email" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"actor_id" text,
	"matched_by" "external_actor_match",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"destination_type" "notification_destination_type" NOT NULL,
	"destination" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "notification_delivery_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"provider_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"acted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notification_inbound_event" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text,
	"delivery_id" text,
	"channel" "notification_channel" NOT NULL,
	"kind" "notification_inbound_event_kind" NOT NULL,
	"from" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"sender_type" "notification_sender_type" NOT NULL,
	"sender_id" text,
	"organization_id" text,
	"category" "notification_category" NOT NULL,
	"priority" "notification_priority" DEFAULT 'normal' NOT NULL,
	"audience" jsonb NOT NULL,
	"channels" "notification_channel"[] NOT NULL,
	"subject" text NOT NULL,
	"body" jsonb NOT NULL,
	"reply_policy" "notification_reply_policy" DEFAULT 'none' NOT NULL,
	"status" "notification_intent_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"idempotency_key" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"quiet_hours" jsonb,
	"categories" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"organizations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_recipient" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"reason" "notification_recipient_reason" NOT NULL,
	"suppressions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_participation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_workspace_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"thread_ts" text NOT NULL,
	"external_user_id" text NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "blob_key" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "byte_size" integer;--> statement-breakpoint
ALTER TABLE "email_suggestion" ADD COLUMN "rfc822_message_id" text;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "last_full_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "label" ADD COLUMN "source_integration_id" text;--> statement-breakpoint
ALTER TABLE "label" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "intent_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "delivery_id" text;--> statement-breakpoint
ALTER TABLE "sync_run" ADD COLUMN "purpose" "sync_run_purpose" DEFAULT 'task_sync' NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "source" "provenance_source" DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "source_integration_id" text;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "external_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "source" "provenance_source" DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "source_integration_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "external_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "external_actor" ADD CONSTRAINT "external_actor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_actor" ADD CONSTRAINT "external_actor_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_actor" ADD CONSTRAINT "external_actor_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_notification_intent_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification_intent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_recipient_id_notification_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."notification_recipient"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_inbound_event" ADD CONSTRAINT "notification_inbound_event_notification_id_notification_intent_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification_intent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_inbound_event" ADD CONSTRAINT "notification_inbound_event_delivery_id_notification_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_delivery"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_intent" ADD CONSTRAINT "notification_intent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient" ADD CONSTRAINT "notification_recipient_notification_id_notification_intent_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification_intent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient" ADD CONSTRAINT "notification_recipient_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_participation" ADD CONSTRAINT "thread_participation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limit_key_idx" ON "rate_limit" USING btree ("key");--> statement-breakpoint
CREATE INDEX "contact_point_user_idx" ON "contact_point" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_point_user_value_uq" ON "contact_point" USING btree ("user_id","type","value_normalized");--> statement-breakpoint
CREATE INDEX "external_actor_org_idx" ON "external_actor" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_actor_uq" ON "external_actor" USING btree ("integration_id","external_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_intent_idx" ON "notification_delivery" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_recipient_idx" ON "notification_delivery" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_status_idx" ON "notification_delivery" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_channel_uq" ON "notification_delivery" USING btree ("recipient_id","channel");--> statement-breakpoint
CREATE INDEX "notification_inbound_event_intent_idx" ON "notification_inbound_event" USING btree ("notification_id","received_at");--> statement-breakpoint
CREATE INDEX "notification_inbound_event_delivery_idx" ON "notification_inbound_event" USING btree ("delivery_id","received_at");--> statement-breakpoint
CREATE INDEX "notification_intent_org_idx" ON "notification_intent" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_intent_status_scheduled_idx" ON "notification_intent" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_intent_idempotency_uq" ON "notification_intent" USING btree ("idempotency_key") WHERE "notification_intent"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "notification_recipient_user_idx" ON "notification_recipient" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipient_user_uq" ON "notification_recipient" USING btree ("notification_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_participation_identity_uq" ON "thread_participation" USING btree ("organization_id","provider","external_workspace_id","channel_id","thread_ts","external_user_id");--> statement-breakpoint
CREATE INDEX "thread_participation_lookup_idx" ON "thread_participation" USING btree ("organization_id","external_workspace_id","channel_id","thread_ts");--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_source_integration_id_integration_id_fk" FOREIGN KEY ("source_integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_intent_id_notification_intent_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."notification_intent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_delivery_id_notification_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."notification_delivery"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_source_integration_id_integration_id_fk" FOREIGN KEY ("source_integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_source_integration_id_integration_id_fk" FOREIGN KEY ("source_integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_suggestion_org_message_id_idx" ON "email_suggestion" USING btree ("organization_id","rfc822_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_source_uq" ON "label" USING btree ("source_integration_id","external_id") WHERE "label"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_source_uq" ON "cycle" USING btree ("source_integration_id","external_id") WHERE "cycle"."source" = 'linked';--> statement-breakpoint
CREATE UNIQUE INDEX "project_source_uq" ON "project" USING btree ("source_integration_id","external_id") WHERE "project"."source" = 'linked';