CREATE TYPE "public"."account_deletion_state" AS ENUM('active', 'pending_deletion');--> statement-breakpoint
CREATE TYPE "public"."account_export_status" AS ENUM('pending', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('email', 'url');--> statement-breakpoint
CREATE TYPE "public"."attachment_subject_type" AS ENUM('task');--> statement-breakpoint
CREATE TYPE "public"."stream_relevance" AS ENUM('mention', 'assignment', 'owned', 'followed', 'participant');--> statement-breakpoint
CREATE TYPE "public"."summary_cadence" AS ENUM('lunch', 'eod', 'eow');--> statement-breakpoint
CREATE TABLE "account_export" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" "account_export_status" DEFAULT 'pending' NOT NULL,
	"blob_key" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"ready_at" timestamp,
	"expires_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"subject_type" "attachment_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"source_integration_id" text,
	"external_id" text,
	"metadata" jsonb,
	"last_email_state_action" text,
	"last_email_state_action_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "observation_recipient" (
	"observation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"reason" "stream_relevance" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "observation_recipient_observation_id_user_id_pk" PRIMARY KEY("observation_id","user_id")
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
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"muted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DROP INDEX "daily_digest_user_date_uq";--> statement-breakpoint
ALTER TABLE "hub" ADD COLUMN "deletion_state" "account_deletion_state" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "hub" ADD COLUMN "deletion_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "hub" ADD COLUMN "delete_after_at" timestamp;--> statement-breakpoint
ALTER TABLE "daily_digest" ADD COLUMN "cadence" "summary_cadence" DEFAULT 'eod' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_export" ADD CONSTRAINT "account_export_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_source_integration_id_integration_id_fk" FOREIGN KEY ("source_integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_recipient" ADD CONSTRAINT "observation_recipient_observation_id_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_recipient" ADD CONSTRAINT "observation_recipient_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_subscription" ADD CONSTRAINT "stream_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_subscription" ADD CONSTRAINT "stream_subscription_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_export_user_idx" ON "account_export" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_export_status_idx" ON "account_export" USING btree ("status");--> statement-breakpoint
CREATE INDEX "attachment_subject_idx" ON "attachment" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_source_uq" ON "attachment" USING btree ("source_integration_id","external_id") WHERE "attachment"."kind" = 'email';--> statement-breakpoint
CREATE INDEX "observation_recipient_user_occurred_idx" ON "observation_recipient" USING btree ("user_id","occurred_at","observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stream_subscription_user_subject_uq" ON "stream_subscription" USING btree ("user_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "stream_subscription_subject_idx" ON "stream_subscription" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_org_provider_account_uq" ON "integration" USING btree ("organization_id","provider","external_account_id") WHERE "integration"."external_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_external_run_uq" ON "agent_session" USING btree ("external_run_ref") WHERE "agent_session"."external_run_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_digest_user_date_cadence_uq" ON "daily_digest" USING btree ("user_id","digest_date","cadence");--> statement-breakpoint
CREATE INDEX "observation_org_occurred_idx" ON "observation" USING btree ("organization_id","occurred_at","id");