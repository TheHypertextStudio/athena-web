CREATE TYPE "public"."publication_subject" AS ENUM('initiative', 'program', 'project');--> statement-breakpoint
CREATE TABLE "athena_conversation_segment" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"start_activity_id" text NOT NULL,
	"end_activity_id" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp NOT NULL,
	"message_count" integer NOT NULL,
	"boundary_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "athena_conversation_segment_span_check" CHECK ("athena_conversation_segment"."message_count" > 0),
	CONSTRAINT "athena_conversation_segment_order_check" CHECK ("athena_conversation_segment"."ordinal" >= 0 AND "athena_conversation_segment"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "publication" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"subject_kind" "publication_subject" NOT NULL,
	"subject_id" text NOT NULL,
	"slug" text NOT NULL,
	"published_at" timestamp,
	"unpublished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workspace_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"host" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp,
	"last_checked_at" timestamp,
	"last_failure" text
);
--> statement-breakpoint
CREATE TABLE "workspace_public_slug" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"slug" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "parent_session_id" text;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "spawn_label" text;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "current_step" text;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "current_step_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "interrupted_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "work_linkage" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD COLUMN "dispatch_origin" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "athena_conversation_segment" ADD CONSTRAINT "athena_conversation_segment_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_conversation_segment" ADD CONSTRAINT "athena_conversation_segment_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_conversation_segment" ADD CONSTRAINT "athena_conversation_segment_owner_fk" FOREIGN KEY ("session_id","owner_user_id") REFERENCES "public"."agent_session"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domain" ADD CONSTRAINT "workspace_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_domain" ADD CONSTRAINT "workspace_domain_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_public_slug" ADD CONSTRAINT "workspace_public_slug_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_public_slug" ADD CONSTRAINT "workspace_public_slug_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "athena_conversation_segment_position_uq" ON "athena_conversation_segment" USING btree ("session_id","revision","ordinal");--> statement-breakpoint
CREATE INDEX "athena_conversation_segment_owner_idx" ON "athena_conversation_segment" USING btree ("owner_user_id","started_at");--> statement-breakpoint
CREATE INDEX "athena_conversation_segment_session_idx" ON "athena_conversation_segment" USING btree ("session_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_subject_uq" ON "publication" USING btree ("organization_id","subject_kind","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_slug_uq" ON "publication" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "publication_org_idx" ON "publication" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_domain_host_uq" ON "workspace_domain" USING btree ("host");--> statement-breakpoint
CREATE INDEX "workspace_domain_org_idx" ON "workspace_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_public_slug_uq" ON "workspace_public_slug" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_public_slug_org_uq" ON "workspace_public_slug" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_parent_session_id_agent_session_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_session_parent_idx" ON "agent_session" USING btree ("parent_session_id");--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_window_ordered" CHECK ("cycle"."ends_at" > "cycle"."starts_at");--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_number_nonneg" CHECK ("cycle"."number" >= 0);--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_starts_at_range" CHECK ("cycle"."starts_at" is null or ("cycle"."starts_at" >= '1970-01-01' and "cycle"."starts_at" < '2201-01-01'));--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_ends_at_range" CHECK ("cycle"."ends_at" is null or ("cycle"."ends_at" >= '1970-01-01' and "cycle"."ends_at" < '2201-01-01'));--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_name_not_blank" CHECK ("initiative"."name" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_target_date_range" CHECK ("initiative"."target_date" is null or ("initiative"."target_date" >= '1970-01-01' and "initiative"."target_date" < '2201-01-01'));--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_name_not_blank" CHECK ("milestone"."name" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_target_date_range" CHECK ("milestone"."target_date" is null or ("milestone"."target_date" >= '1970-01-01' and "milestone"."target_date" < '2201-01-01'));--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_sort_nonneg" CHECK ("milestone"."sort" >= 0);--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_name_not_blank" CHECK ("program"."name" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_name_not_blank" CHECK ("project"."name" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_start_date_range" CHECK ("project"."start_date" is null or ("project"."start_date" >= '1970-01-01' and "project"."start_date" < '2201-01-01'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_target_date_range" CHECK ("project"."target_date" is null or ("project"."target_date" >= '1970-01-01' and "project"."target_date" < '2201-01-01'));--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_title_not_blank" CHECK ("task"."title" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_state_not_blank" CHECK ("task"."state" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_not_own_parent" CHECK ("task"."parent_task_id" is null or "task"."parent_task_id" <> "task"."id");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_estimate_nonneg" CHECK ("task"."estimate" is null or "task"."estimate" >= 0);--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_estimate_minutes_nonneg" CHECK ("task"."estimate_minutes" is null or "task"."estimate_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_start_date_range" CHECK ("task"."start_date" is null or ("task"."start_date" >= '1970-01-01' and "task"."start_date" < '2201-01-01'));--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_due_date_range" CHECK ("task"."due_date" is null or ("task"."due_date" >= '1970-01-01' and "task"."due_date" < '2201-01-01'));--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_work_linkage_check" CHECK (("agent_session"."work_linkage" = 'task' AND "agent_session"."task_id" IS NOT NULL)
        OR ("agent_session"."work_linkage" = 'conversation' AND "agent_session"."kind" = 'chat')
        OR "agent_session"."work_linkage" = 'unclassified');--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_no_self_parent_check" CHECK ("agent_session"."parent_session_id" IS NULL OR "agent_session"."parent_session_id" <> "agent_session"."id");--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD CONSTRAINT "agent_session_run_dispatch_origin_check" CHECK ("agent_session_run"."dispatch_origin" in ('athena_admission', 'execution_advance', 'lease_recovery', 'unclassified'));