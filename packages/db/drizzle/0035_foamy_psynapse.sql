CREATE TYPE "public"."agent_execution_status" AS ENUM('queued', 'running', 'tool_wait', 'awaiting_human', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."agent_session_run_status" AS ENUM('queued', 'running', 'waiting', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."time_allocation_target_kind" AS ENUM('task', 'workspace', 'project', 'category');--> statement-breakpoint
CREATE TYPE "public"."time_capture_source" AS ENUM('live', 'manual', 'reconstructed', 'agent');--> statement-breakpoint
CREATE TYPE "public"."time_context_role" AS ENUM('primary', 'related', 'calendar_context', 'planning_context', 'agent_context');--> statement-breakpoint
CREATE TYPE "public"."time_interval_actor_kind" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."time_interval_mode" AS ENUM('human_active', 'agent_active', 'tool_wait', 'awaiting_human');--> statement-breakpoint
CREATE TYPE "public"."time_interval_source" AS ENUM('user_timer', 'manual_entry', 'reconstructed_entry', 'agent_runtime');--> statement-breakpoint
CREATE TYPE "public"."time_record_status" AS ENUM('open', 'paused', 'closed', 'submitted', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."time_submission_status" AS ENUM('draft', 'submitted', 'withdrawn');--> statement-breakpoint
CREATE TABLE "agent_session_run" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"generation" integer NOT NULL,
	"workflow_instance_id" text NOT NULL,
	"status" "agent_session_run_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp,
	"last_error" text,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"parent_execution_id" text,
	"time_record_id" text,
	"initiated_by_user_id" text,
	"status" "agent_execution_status" DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"runtime_ref" text,
	"failure_summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"time_record_id" text NOT NULL,
	"target_kind" time_allocation_target_kind NOT NULL,
	"target_id" text NOT NULL,
	"organization_id" text,
	"basis_points" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_category" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"color" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_context" (
	"id" text PRIMARY KEY NOT NULL,
	"time_record_id" text NOT NULL,
	"role" time_context_role NOT NULL,
	"entity_kind" text NOT NULL,
	"source_system" text NOT NULL,
	"external_id" text NOT NULL,
	"title_snapshot" text,
	"url_snapshot" text,
	"docket_entity_id" text,
	"organization_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_interval" (
	"id" text PRIMARY KEY NOT NULL,
	"time_record_id" text NOT NULL,
	"hub_id" text NOT NULL,
	"actor_kind" time_interval_actor_kind NOT NULL,
	"user_id" text,
	"agent_execution_id" text,
	"mode" time_interval_mode NOT NULL,
	"source" time_interval_source NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"superseded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "time_record" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"title" text NOT NULL,
	"outcome_note" text,
	"status" time_record_status DEFAULT 'open' NOT NULL,
	"category_id" text,
	"capture_source" time_capture_source DEFAULT 'live' NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"closed_at" timestamp,
	"superseded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"submitted_by_user_id" text NOT NULL,
	"organization_id" text,
	"status" time_submission_status DEFAULT 'draft' NOT NULL,
	"period_starts_at" timestamp NOT NULL,
	"period_ends_at" timestamp NOT NULL,
	"timezone" text NOT NULL,
	"measure" text NOT NULL,
	"rounding_policy" text DEFAULT 'none' NOT NULL,
	"submitted_at" timestamp,
	"withdrawn_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_submission_item" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"time_record_id" text NOT NULL,
	"allocation_id" text,
	"target_kind" time_allocation_target_kind,
	"target_id" text,
	"basis_points" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD CONSTRAINT "agent_session_run_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD CONSTRAINT "agent_session_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution" ADD CONSTRAINT "agent_execution_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution" ADD CONSTRAINT "agent_execution_time_record_id_time_record_id_fk" FOREIGN KEY ("time_record_id") REFERENCES "public"."time_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution" ADD CONSTRAINT "agent_execution_initiated_by_user_id_user_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_allocation" ADD CONSTRAINT "time_allocation_time_record_id_time_record_id_fk" FOREIGN KEY ("time_record_id") REFERENCES "public"."time_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_allocation" ADD CONSTRAINT "time_allocation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_category" ADD CONSTRAINT "time_category_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_context" ADD CONSTRAINT "time_context_time_record_id_time_record_id_fk" FOREIGN KEY ("time_record_id") REFERENCES "public"."time_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_context" ADD CONSTRAINT "time_context_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_context" ADD CONSTRAINT "time_context_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_interval" ADD CONSTRAINT "time_interval_time_record_id_time_record_id_fk" FOREIGN KEY ("time_record_id") REFERENCES "public"."time_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_interval" ADD CONSTRAINT "time_interval_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_interval" ADD CONSTRAINT "time_interval_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record" ADD CONSTRAINT "time_record_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record" ADD CONSTRAINT "time_record_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record" ADD CONSTRAINT "time_record_category_id_time_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."time_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_submission" ADD CONSTRAINT "time_submission_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_submission" ADD CONSTRAINT "time_submission_submitted_by_user_id_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_submission" ADD CONSTRAINT "time_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_submission_item" ADD CONSTRAINT "time_submission_item_submission_id_time_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."time_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_submission_item" ADD CONSTRAINT "time_submission_item_time_record_id_time_record_id_fk" FOREIGN KEY ("time_record_id") REFERENCES "public"."time_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_submission_item" ADD CONSTRAINT "time_submission_item_allocation_id_time_allocation_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."time_allocation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_run_generation_uq" ON "agent_session_run" USING btree ("session_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_run_workflow_uq" ON "agent_session_run" USING btree ("workflow_instance_id");--> statement-breakpoint
CREATE INDEX "agent_session_run_org_status_idx" ON "agent_session_run" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "agent_execution_session_idx" ON "agent_execution" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_execution_one_open_per_session_uq" ON "agent_execution" USING btree ("session_id") WHERE "agent_execution"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "agent_execution_record_idx" ON "agent_execution" USING btree ("time_record_id");--> statement-breakpoint
CREATE INDEX "agent_execution_parent_idx" ON "agent_execution" USING btree ("parent_execution_id");--> statement-breakpoint
CREATE INDEX "time_allocation_record_idx" ON "time_allocation" USING btree ("time_record_id");--> statement-breakpoint
CREATE INDEX "time_allocation_target_idx" ON "time_allocation" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "time_category_hub_idx" ON "time_category" USING btree ("hub_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_category_hub_name_uq" ON "time_category" USING btree ("hub_id","name");--> statement-breakpoint
CREATE INDEX "time_context_record_idx" ON "time_context" USING btree ("time_record_id");--> statement-breakpoint
CREATE INDEX "time_context_org_entity_idx" ON "time_context" USING btree ("organization_id","docket_entity_id");--> statement-breakpoint
CREATE INDEX "time_interval_record_started_idx" ON "time_interval" USING btree ("time_record_id","started_at");--> statement-breakpoint
CREATE INDEX "time_interval_hub_started_idx" ON "time_interval" USING btree ("hub_id","started_at");--> statement-breakpoint
CREATE INDEX "time_interval_user_active_idx" ON "time_interval" USING btree ("user_id","ended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "time_interval_one_active_human_per_hub_uq" ON "time_interval" USING btree ("hub_id") WHERE "time_interval"."mode" = 'human_active' AND "time_interval"."ended_at" IS NULL AND "time_interval"."superseded_by_id" IS NULL;--> statement-breakpoint
CREATE INDEX "time_interval_agent_execution_idx" ON "time_interval" USING btree ("agent_execution_id");--> statement-breakpoint
CREATE INDEX "time_record_hub_started_idx" ON "time_record" USING btree ("hub_id","started_at");--> statement-breakpoint
CREATE INDEX "time_record_user_started_idx" ON "time_record" USING btree ("created_by_user_id","started_at");--> statement-breakpoint
CREATE INDEX "time_record_hub_status_idx" ON "time_record" USING btree ("hub_id","status");--> statement-breakpoint
CREATE INDEX "time_submission_hub_period_idx" ON "time_submission" USING btree ("hub_id","period_starts_at");--> statement-breakpoint
CREATE INDEX "time_submission_org_idx" ON "time_submission" USING btree ("organization_id","submitted_at");--> statement-breakpoint
CREATE INDEX "time_submission_item_submission_idx" ON "time_submission_item" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "time_submission_item_record_idx" ON "time_submission_item" USING btree ("time_record_id");