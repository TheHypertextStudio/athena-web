CREATE TYPE "public"."search_document_family" AS ENUM('work', 'people', 'content', 'activity');--> statement-breakpoint
CREATE TYPE "public"."search_document_kind" AS ENUM('organization', 'team', 'member', 'agent', 'agent_session', 'task', 'project', 'program', 'initiative', 'milestone', 'cycle', 'label', 'saved_view', 'comment', 'update', 'attachment', 'calendar_event', 'activity');--> statement-breakpoint
CREATE TYPE "public"."search_index_job_operation" AS ENUM('upsert', 'delete');--> statement-breakpoint
CREATE TYPE "public"."search_index_job_reason" AS ENUM('entity_write', 'event_log', 'backfill', 'repair', 'manual');--> statement-breakpoint
CREATE TYPE "public"."search_index_job_status" AS ENUM('pending', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "search_document" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text,
	"kind" "search_document_kind" NOT NULL,
	"family" "search_document_family" NOT NULL,
	"source_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"subject_kind" text,
	"subject_id" text,
	"source_system" "source_system",
	"external_url" text,
	"title" text NOT NULL,
	"summary" text,
	"body" text,
	"facet" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"route" jsonb NOT NULL,
	"visibility" jsonb NOT NULL,
	"base_rank" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp,
	"source_updated_at" timestamp,
	"indexed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "search_index_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text,
	"source_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"operation" "search_index_job_operation" NOT NULL,
	"reason" "search_index_job_reason" NOT NULL,
	"source_event_id" text,
	"dedupe_key" text NOT NULL,
	"status" "search_index_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "search_document" ADD CONSTRAINT "search_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_document" ADD CONSTRAINT "search_document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_index_job" ADD CONSTRAINT "search_index_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_index_job" ADD CONSTRAINT "search_index_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_document_org_family_rank_idx" ON "search_document" USING btree ("organization_id","family","base_rank","updated_at");--> statement-breakpoint
CREATE INDEX "search_document_org_kind_rank_idx" ON "search_document" USING btree ("organization_id","kind","base_rank","updated_at");--> statement-breakpoint
CREATE INDEX "search_document_user_family_idx" ON "search_document" USING btree ("user_id","family","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "search_document_source_uq" ON "search_document" USING btree ("source_table","entity_id");--> statement-breakpoint
CREATE INDEX "search_document_subject_idx" ON "search_document" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "search_document_facet_gin" ON "search_document" USING gin ("facet");--> statement-breakpoint
CREATE INDEX "search_document_text_gin" ON "search_document" USING gin ((
        setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce("summary", '')), 'B') ||
        setweight(to_tsvector('simple', coalesce("body", '')), 'C')
      ));--> statement-breakpoint
CREATE UNIQUE INDEX "search_index_job_active_dedupe_uq" ON "search_index_job" USING btree ("dedupe_key") WHERE "search_index_job"."status" in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "search_index_job_status_run_idx" ON "search_index_job" USING btree ("status","run_after","created_at");--> statement-breakpoint
CREATE INDEX "search_index_job_source_idx" ON "search_index_job" USING btree ("source_table","entity_id");