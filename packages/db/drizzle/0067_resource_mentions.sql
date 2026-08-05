CREATE TYPE "public"."external_resource_type" AS ENUM('document', 'spreadsheet', 'presentation', 'folder', 'pdf', 'image', 'video', 'file', 'issue', 'message', 'event', 'page', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."mention_entity_kind" AS ENUM('task', 'project', 'program', 'initiative', 'cycle', 'milestone', 'team', 'actor', 'agent_session', 'comment', 'update');--> statement-breakpoint
CREATE TYPE "public"."mention_subject_type" AS ENUM('task', 'project', 'program', 'initiative', 'comment', 'update');--> statement-breakpoint
CREATE TYPE "public"."mention_target_kind" AS ENUM('entity', 'external');--> statement-breakpoint
CREATE TYPE "public"."resource_provider" AS ENUM('web', 'google_drive');--> statement-breakpoint
CREATE TYPE "public"."resource_unfurl_status" AS ENUM('pending', 'ok', 'forbidden', 'requires_connection', 'unsupported', 'failed');--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'google_drive' BEFORE 'outlook';--> statement-breakpoint
CREATE TABLE "external_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"provider" "resource_provider" NOT NULL,
	"canonical_key" text NOT NULL,
	"canonical_url" text NOT NULL,
	"external_id" text,
	"source_integration_id" text,
	"resource_type" "external_resource_type" DEFAULT 'unknown' NOT NULL,
	"title" text,
	"description" text,
	"site_name" text,
	"icon_url" text,
	"thumbnail_url" text,
	"mime_type" text,
	"owner_label" text,
	"external_updated_at" timestamp,
	"unfurl_status" "resource_unfurl_status" DEFAULT 'pending' NOT NULL,
	"unfurl_attempts" integer DEFAULT 0 NOT NULL,
	"unfurl_after" timestamp DEFAULT now() NOT NULL,
	"unfurl_lease_token" text,
	"unfurl_lease_expires_at" timestamp,
	"unfurl_error" text,
	"fetched_at" timestamp,
	"stale_after" timestamp
);
--> statement-breakpoint
CREATE TABLE "mention" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"subject_type" "mention_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"field" text NOT NULL,
	"position" integer NOT NULL,
	"target_kind" "mention_target_kind" NOT NULL,
	"target_entity_kind" "mention_entity_kind",
	"target_entity_id" text,
	"external_resource_id" text,
	"label" text NOT NULL,
	CONSTRAINT "mention_entity_arm_check" CHECK (("mention"."target_kind" = 'entity') = ("mention"."target_entity_kind" IS NOT NULL AND "mention"."target_entity_id" IS NOT NULL)),
	CONSTRAINT "mention_external_arm_check" CHECK (("mention"."target_kind" = 'external') = ("mention"."external_resource_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "mention_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"canonical_key" text NOT NULL,
	"use_count" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "external_resource_id" text;--> statement-breakpoint
ALTER TABLE "external_resource" ADD CONSTRAINT "external_resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource" ADD CONSTRAINT "external_resource_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource" ADD CONSTRAINT "external_resource_source_integration_id_integration_id_fk" FOREIGN KEY ("source_integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_external_resource_id_external_resource_id_fk" FOREIGN KEY ("external_resource_id") REFERENCES "public"."external_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_usage" ADD CONSTRAINT "mention_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_usage" ADD CONSTRAINT "mention_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_resource_key_uq" ON "external_resource" USING btree ("organization_id","canonical_key");--> statement-breakpoint
CREATE INDEX "external_resource_unfurl_due_idx" ON "external_resource" USING btree ("unfurl_status","unfurl_after");--> statement-breakpoint
CREATE INDEX "external_resource_provider_idx" ON "external_resource" USING btree ("organization_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "mention_subject_idx" ON "mention" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "mention_target_entity_idx" ON "mention" USING btree ("organization_id","target_entity_kind","target_entity_id");--> statement-breakpoint
CREATE INDEX "mention_resource_idx" ON "mention" USING btree ("external_resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mention_inline_uq" ON "mention" USING btree ("subject_type","subject_id","field","position");--> statement-breakpoint
CREATE UNIQUE INDEX "mention_usage_user_key_uq" ON "mention_usage" USING btree ("user_id","organization_id","canonical_key");--> statement-breakpoint
CREATE INDEX "mention_usage_recent_idx" ON "mention_usage" USING btree ("user_id","organization_id","last_used_at");