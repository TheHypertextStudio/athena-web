CREATE TYPE "public"."missed_occurrence_policy" AS ENUM('skip', 'carry', 'resolve');--> statement-breakpoint
CREATE TYPE "public"."process_creation_mode" AS ENUM('all_at_once', 'when_ready');--> statement-breakpoint
CREATE TYPE "public"."process_definition_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."process_instance_status" AS ENUM('pending', 'active', 'completed', 'canceled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."process_occurrence_status" AS ENUM('expected', 'materialized', 'completed', 'skipped', 'canceled', 'needs_resolution', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."process_step_kind" AS ENUM('project', 'milestone', 'task');--> statement-breakpoint
CREATE TYPE "public"."process_step_timing_kind" AS ENUM('on_trigger', 'relative_to_trigger', 'after_step_completion');--> statement-breakpoint
CREATE TYPE "public"."process_trigger_kind" AS ENUM('manual', 'calendar', 'after_completion', 'event');--> statement-breakpoint
CREATE TYPE "public"."recurrence_calendar_overflow" AS ENUM('skip', 'last_day');--> statement-breakpoint
CREATE TYPE "public"."recurrence_end_kind" AS ENUM('never', 'on_date', 'after_count');--> statement-breakpoint
CREATE TYPE "public"."recurrence_exception_kind" AS ENUM('exclude', 'include', 'reschedule');--> statement-breakpoint
CREATE TYPE "public"."recurrence_interval_unit" AS ENUM('day', 'week', 'month');--> statement-breakpoint
CREATE TYPE "public"."recurrence_monthly_pattern_kind" AS ENUM('day_of_month', 'nth_weekday');--> statement-breakpoint
CREATE TYPE "public"."recurrence_schedule_kind" AS ENUM('daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."recurrence_series_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TABLE "calendar_process_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"calendar_layer_id" text NOT NULL,
	"external_series_id" text NOT NULL,
	"definition_id" text NOT NULL,
	"series_id" text NOT NULL,
	CONSTRAINT "calendar_process_binding_external_series_not_blank" CHECK (length(btrim("calendar_process_binding"."external_series_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "process_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"name" text NOT NULL,
	"description" text,
	"status" "process_definition_status" DEFAULT 'draft' NOT NULL,
	CONSTRAINT "process_definition_name_not_blank" CHECK (length(btrim("process_definition"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "process_dependency" (
	"revision_id" text NOT NULL,
	"blocking_step_id" text NOT NULL,
	"blocked_step_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "process_dependency_blocking_step_id_blocked_step_id_pk" PRIMARY KEY("blocking_step_id","blocked_step_id"),
	CONSTRAINT "process_dependency_not_self" CHECK ("process_dependency"."blocking_step_id" <> "process_dependency"."blocked_step_id")
);
--> statement-breakpoint
CREATE TABLE "process_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"definition_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"occurrence_id" text,
	"status" "process_instance_status" DEFAULT 'active' NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"failure_code" text
);
--> statement-breakpoint
CREATE TABLE "process_instance_milestone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"instance_id" text NOT NULL,
	"step_id" text NOT NULL,
	"milestone_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_instance_project" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"instance_id" text NOT NULL,
	"step_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_instance_task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"instance_id" text NOT NULL,
	"step_id" text NOT NULL,
	"task_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_milestone_spec" (
	"step_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_step_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_offset_days" integer,
	CONSTRAINT "process_milestone_spec_name_not_blank" CHECK (length(btrim("process_milestone_spec"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "process_occurrence" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"series_id" text NOT NULL,
	"series_revision_id" text NOT NULL,
	"scheduled_for" date NOT NULL,
	"original_scheduled_for" date,
	"status" "process_occurrence_status" DEFAULT 'expected' NOT NULL,
	"external_occurrence_key" text,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "process_project_label_spec" (
	"project_step_id" text NOT NULL,
	"label_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "process_project_label_spec_project_step_id_label_id_pk" PRIMARY KEY("project_step_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "process_project_spec" (
	"step_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"description" text,
	"lead_id" text,
	"team_id" text,
	"program_id" text,
	"status" "project_status" DEFAULT 'planned' NOT NULL,
	"health" "health",
	"start_offset_days" integer,
	"target_offset_days" integer,
	CONSTRAINT "process_project_spec_name_not_blank" CHECK (length(btrim("process_project_spec"."name")) > 0),
	CONSTRAINT "process_project_spec_date_offsets_ordered" CHECK ("process_project_spec"."start_offset_days" is null or "process_project_spec"."target_offset_days" is null or "process_project_spec"."target_offset_days" >= "process_project_spec"."start_offset_days")
);
--> statement-breakpoint
CREATE TABLE "process_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"definition_id" text NOT NULL,
	"number" integer NOT NULL,
	"creation_mode" "process_creation_mode" DEFAULT 'all_at_once' NOT NULL,
	"published_at" timestamp,
	CONSTRAINT "process_revision_number_positive" CHECK ("process_revision"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "process_step" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"revision_id" text NOT NULL,
	"key" text NOT NULL,
	"kind" "process_step_kind" NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"timing_kind" "process_step_timing_kind" DEFAULT 'on_trigger' NOT NULL,
	"offset_days" integer,
	"after_step_id" text,
	CONSTRAINT "process_step_sort_nonneg" CHECK ("process_step"."sort" >= 0),
	CONSTRAINT "process_step_timing_shape_check" CHECK ((
        ("process_step"."timing_kind" = 'on_trigger' and "process_step"."offset_days" is null and "process_step"."after_step_id" is null)
        or ("process_step"."timing_kind" = 'relative_to_trigger' and "process_step"."offset_days" is not null and "process_step"."after_step_id" is null)
        or ("process_step"."timing_kind" = 'after_step_completion' and "process_step"."offset_days" is not null and "process_step"."offset_days" >= 0 and "process_step"."after_step_id" is not null)
      )),
	CONSTRAINT "process_step_not_own_predecessor" CHECK ("process_step"."after_step_id" is null or "process_step"."after_step_id" <> "process_step"."id")
);
--> statement-breakpoint
CREATE TABLE "process_task_label_spec" (
	"task_step_id" text NOT NULL,
	"label_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "process_task_label_spec_task_step_id_label_id_pk" PRIMARY KEY("task_step_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "process_task_spec" (
	"step_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"team_id" text NOT NULL,
	"state" text,
	"priority" "task_priority" DEFAULT 'none' NOT NULL,
	"assignee_id" text,
	"project_id" text,
	"project_step_id" text,
	"milestone_id" text,
	"milestone_step_id" text,
	"cycle_id" text,
	"parent_task_id" text,
	"parent_task_step_id" text,
	"estimate" integer,
	"estimate_minutes" integer,
	"start_offset_days" integer,
	"due_offset_days" integer,
	CONSTRAINT "process_task_spec_title_not_blank" CHECK (length(btrim("process_task_spec"."title")) > 0),
	CONSTRAINT "process_task_spec_state_not_blank" CHECK ("process_task_spec"."state" is null or length(btrim("process_task_spec"."state")) > 0),
	CONSTRAINT "process_task_spec_estimate_nonneg" CHECK ("process_task_spec"."estimate" is null or "process_task_spec"."estimate" >= 0),
	CONSTRAINT "process_task_spec_estimate_minutes_nonneg" CHECK ("process_task_spec"."estimate_minutes" is null or "process_task_spec"."estimate_minutes" >= 0),
	CONSTRAINT "process_task_spec_not_own_parent" CHECK ("process_task_spec"."parent_task_step_id" is null or "process_task_spec"."parent_task_step_id" <> "process_task_spec"."step_id"),
	CONSTRAINT "process_task_spec_reference_shape_check" CHECK ("process_task_spec"."project_id" is null or "process_task_spec"."project_step_id" is null),
	CONSTRAINT "process_task_spec_milestone_reference_shape_check" CHECK ("process_task_spec"."milestone_id" is null or "process_task_spec"."milestone_step_id" is null),
	CONSTRAINT "process_task_spec_parent_reference_shape_check" CHECK ("process_task_spec"."parent_task_id" is null or "process_task_spec"."parent_task_step_id" is null),
	CONSTRAINT "process_task_spec_date_offsets_ordered" CHECK ("process_task_spec"."start_offset_days" is null or "process_task_spec"."due_offset_days" is null or "process_task_spec"."due_offset_days" >= "process_task_spec"."start_offset_days")
);
--> statement-breakpoint
CREATE TABLE "recurrence_exception" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"series_revision_id" text NOT NULL,
	"kind" "recurrence_exception_kind" NOT NULL,
	"scheduled_for" date NOT NULL,
	"replacement_date" date,
	CONSTRAINT "recurrence_exception_shape_check" CHECK ((
        ("recurrence_exception"."kind" in ('exclude', 'include') and "recurrence_exception"."replacement_date" is null)
        or ("recurrence_exception"."kind" = 'reschedule' and "recurrence_exception"."replacement_date" is not null and "recurrence_exception"."replacement_date" <> "recurrence_exception"."scheduled_for")
      ))
);
--> statement-breakpoint
CREATE TABLE "recurrence_series" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"definition_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "recurrence_series_status" DEFAULT 'active' NOT NULL,
	"paused_at" timestamp,
	"ended_at" timestamp,
	CONSTRAINT "recurrence_series_name_not_blank" CHECK (length(btrim("recurrence_series"."name")) > 0),
	CONSTRAINT "recurrence_series_lifecycle_shape_check" CHECK ((
        ("recurrence_series"."status" = 'active' and "recurrence_series"."ended_at" is null)
        or ("recurrence_series"."status" = 'paused' and "recurrence_series"."paused_at" is not null and "recurrence_series"."ended_at" is null)
        or ("recurrence_series"."status" = 'ended' and "recurrence_series"."ended_at" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "recurrence_series_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"series_id" text NOT NULL,
	"process_revision_id" text NOT NULL,
	"number" integer NOT NULL,
	"effective_from" date NOT NULL,
	"trigger_kind" "process_trigger_kind" NOT NULL,
	"schedule_kind" "recurrence_schedule_kind",
	"interval" integer,
	"start_date" date,
	"timezone" text,
	"end_kind" "recurrence_end_kind",
	"end_date" date,
	"end_count" integer,
	"monthly_pattern_kind" "recurrence_monthly_pattern_kind",
	"month_day" integer,
	"nth_weekday_ordinal" integer,
	"nth_weekday" integer,
	"year_month" integer,
	"year_day" integer,
	"overflow" "recurrence_calendar_overflow",
	"interval_unit" "recurrence_interval_unit",
	"missed_policy" "missed_occurrence_policy",
	"horizon_days" integer,
	"minimum_occurrences" integer,
	"event_kind" text,
	"event_subject_type" text,
	"event_source" text,
	"event_entity_kind" text,
	CONSTRAINT "recurrence_series_revision_number_positive" CHECK ("recurrence_series_revision"."number" > 0),
	CONSTRAINT "recurrence_series_revision_trigger_shape_check" CHECK ((
        ("recurrence_series_revision"."trigger_kind" = 'manual' and "recurrence_series_revision"."schedule_kind" is null and "recurrence_series_revision"."interval" is null and "recurrence_series_revision"."start_date" is null and "recurrence_series_revision"."timezone" is null and "recurrence_series_revision"."end_kind" is null and "recurrence_series_revision"."missed_policy" is null and "recurrence_series_revision"."horizon_days" is null and "recurrence_series_revision"."minimum_occurrences" is null and "recurrence_series_revision"."interval_unit" is null and "recurrence_series_revision"."event_kind" is null and "recurrence_series_revision"."event_subject_type" is null and "recurrence_series_revision"."event_source" is null and "recurrence_series_revision"."event_entity_kind" is null)
        or ("recurrence_series_revision"."trigger_kind" = 'calendar' and "recurrence_series_revision"."schedule_kind" is not null and "recurrence_series_revision"."interval" > 0 and "recurrence_series_revision"."start_date" is not null and length(btrim("recurrence_series_revision"."timezone")) > 0 and "recurrence_series_revision"."end_kind" is not null and "recurrence_series_revision"."missed_policy" is not null and "recurrence_series_revision"."horizon_days" > 0 and "recurrence_series_revision"."minimum_occurrences" > 0 and "recurrence_series_revision"."interval_unit" is null)
        or ("recurrence_series_revision"."trigger_kind" = 'after_completion' and "recurrence_series_revision"."schedule_kind" is null and "recurrence_series_revision"."interval" > 0 and "recurrence_series_revision"."interval_unit" is not null and "recurrence_series_revision"."start_date" is null and "recurrence_series_revision"."timezone" is null and "recurrence_series_revision"."end_kind" is null and "recurrence_series_revision"."missed_policy" is null and "recurrence_series_revision"."horizon_days" is null and "recurrence_series_revision"."minimum_occurrences" is null)
        or ("recurrence_series_revision"."trigger_kind" = 'event' and "recurrence_series_revision"."schedule_kind" is null and "recurrence_series_revision"."interval" is null and "recurrence_series_revision"."interval_unit" is null and ("recurrence_series_revision"."event_kind" is not null or "recurrence_series_revision"."event_subject_type" is not null or "recurrence_series_revision"."event_source" is not null or "recurrence_series_revision"."event_entity_kind" is not null))
      )),
	CONSTRAINT "recurrence_series_revision_end_shape_check" CHECK ((
        ("recurrence_series_revision"."trigger_kind" <> 'calendar' and "recurrence_series_revision"."end_kind" is null and "recurrence_series_revision"."end_date" is null and "recurrence_series_revision"."end_count" is null)
        or ("recurrence_series_revision"."trigger_kind" = 'calendar' and "recurrence_series_revision"."end_kind" = 'never' and "recurrence_series_revision"."end_date" is null and "recurrence_series_revision"."end_count" is null)
        or ("recurrence_series_revision"."trigger_kind" = 'calendar' and "recurrence_series_revision"."end_kind" = 'on_date' and "recurrence_series_revision"."end_date" is not null and "recurrence_series_revision"."end_count" is null and "recurrence_series_revision"."end_date" >= "recurrence_series_revision"."start_date")
        or ("recurrence_series_revision"."trigger_kind" = 'calendar' and "recurrence_series_revision"."end_kind" = 'after_count' and "recurrence_series_revision"."end_date" is null and "recurrence_series_revision"."end_count" > 0)
      )),
	CONSTRAINT "recurrence_series_revision_schedule_shape_check" CHECK ((
        ("recurrence_series_revision"."schedule_kind" is null and "recurrence_series_revision"."monthly_pattern_kind" is null and "recurrence_series_revision"."month_day" is null and "recurrence_series_revision"."nth_weekday_ordinal" is null and "recurrence_series_revision"."nth_weekday" is null and "recurrence_series_revision"."year_month" is null and "recurrence_series_revision"."year_day" is null and "recurrence_series_revision"."overflow" is null)
        or ("recurrence_series_revision"."schedule_kind" in ('daily', 'weekly') and "recurrence_series_revision"."monthly_pattern_kind" is null and "recurrence_series_revision"."month_day" is null and "recurrence_series_revision"."nth_weekday_ordinal" is null and "recurrence_series_revision"."nth_weekday" is null and "recurrence_series_revision"."year_month" is null and "recurrence_series_revision"."year_day" is null and "recurrence_series_revision"."overflow" is null)
        or ("recurrence_series_revision"."schedule_kind" = 'monthly' and "recurrence_series_revision"."monthly_pattern_kind" = 'day_of_month' and "recurrence_series_revision"."month_day" between 1 and 31 and "recurrence_series_revision"."nth_weekday_ordinal" is null and "recurrence_series_revision"."nth_weekday" is null and "recurrence_series_revision"."year_month" is null and "recurrence_series_revision"."year_day" is null and "recurrence_series_revision"."overflow" is not null)
        or ("recurrence_series_revision"."schedule_kind" = 'monthly' and "recurrence_series_revision"."monthly_pattern_kind" = 'nth_weekday' and "recurrence_series_revision"."month_day" is null and "recurrence_series_revision"."nth_weekday_ordinal" in (-1, 1, 2, 3, 4, 5) and "recurrence_series_revision"."nth_weekday" between 1 and 7 and "recurrence_series_revision"."year_month" is null and "recurrence_series_revision"."year_day" is null and "recurrence_series_revision"."overflow" is null)
        or ("recurrence_series_revision"."schedule_kind" = 'yearly' and "recurrence_series_revision"."monthly_pattern_kind" is null and "recurrence_series_revision"."month_day" is null and "recurrence_series_revision"."nth_weekday_ordinal" is null and "recurrence_series_revision"."nth_weekday" is null and "recurrence_series_revision"."year_month" between 1 and 12 and "recurrence_series_revision"."year_day" between 1 and 31 and "recurrence_series_revision"."overflow" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "recurrence_series_weekday" (
	"series_revision_id" text NOT NULL,
	"weekday" integer NOT NULL,
	CONSTRAINT "recurrence_series_weekday_series_revision_id_weekday_pk" PRIMARY KEY("series_revision_id","weekday"),
	CONSTRAINT "recurrence_series_weekday_range" CHECK ("recurrence_series_weekday"."weekday" between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE "calendar_process_binding" ADD CONSTRAINT "calendar_process_binding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_process_binding" ADD CONSTRAINT "calendar_process_binding_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_process_binding" ADD CONSTRAINT "calendar_process_binding_calendar_layer_id_calendar_layer_id_fk" FOREIGN KEY ("calendar_layer_id") REFERENCES "public"."calendar_layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_process_binding" ADD CONSTRAINT "calendar_process_binding_definition_id_process_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."process_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_process_binding" ADD CONSTRAINT "calendar_process_binding_series_id_recurrence_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurrence_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_definition" ADD CONSTRAINT "process_definition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_definition" ADD CONSTRAINT "process_definition_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_dependency" ADD CONSTRAINT "process_dependency_revision_id_process_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."process_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_dependency" ADD CONSTRAINT "process_dependency_blocking_step_id_process_task_spec_step_id_fk" FOREIGN KEY ("blocking_step_id") REFERENCES "public"."process_task_spec"("step_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_dependency" ADD CONSTRAINT "process_dependency_blocked_step_id_process_task_spec_step_id_fk" FOREIGN KEY ("blocked_step_id") REFERENCES "public"."process_task_spec"("step_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_dependency" ADD CONSTRAINT "process_dependency_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance" ADD CONSTRAINT "process_instance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance" ADD CONSTRAINT "process_instance_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance" ADD CONSTRAINT "process_instance_definition_id_process_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."process_definition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance" ADD CONSTRAINT "process_instance_revision_id_process_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."process_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance" ADD CONSTRAINT "process_instance_occurrence_id_process_occurrence_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."process_occurrence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_milestone" ADD CONSTRAINT "process_instance_milestone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_milestone" ADD CONSTRAINT "process_instance_milestone_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_milestone" ADD CONSTRAINT "process_instance_milestone_instance_id_process_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."process_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_milestone" ADD CONSTRAINT "process_instance_milestone_step_id_process_milestone_spec_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."process_milestone_spec"("step_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_milestone" ADD CONSTRAINT "process_instance_milestone_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_project" ADD CONSTRAINT "process_instance_project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_project" ADD CONSTRAINT "process_instance_project_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_project" ADD CONSTRAINT "process_instance_project_instance_id_process_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."process_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_project" ADD CONSTRAINT "process_instance_project_step_id_process_project_spec_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."process_project_spec"("step_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_project" ADD CONSTRAINT "process_instance_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_task" ADD CONSTRAINT "process_instance_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_task" ADD CONSTRAINT "process_instance_task_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_task" ADD CONSTRAINT "process_instance_task_instance_id_process_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."process_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_task" ADD CONSTRAINT "process_instance_task_step_id_process_task_spec_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."process_task_spec"("step_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_instance_task" ADD CONSTRAINT "process_instance_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_milestone_spec" ADD CONSTRAINT "process_milestone_spec_step_id_process_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."process_step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_milestone_spec" ADD CONSTRAINT "process_milestone_spec_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_milestone_spec" ADD CONSTRAINT "process_milestone_spec_project_step_id_process_project_spec_step_id_fk" FOREIGN KEY ("project_step_id") REFERENCES "public"."process_project_spec"("step_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_occurrence" ADD CONSTRAINT "process_occurrence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_occurrence" ADD CONSTRAINT "process_occurrence_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_occurrence" ADD CONSTRAINT "process_occurrence_series_id_recurrence_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurrence_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_occurrence" ADD CONSTRAINT "process_occurrence_series_revision_id_recurrence_series_revision_id_fk" FOREIGN KEY ("series_revision_id") REFERENCES "public"."recurrence_series_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_project_label_spec" ADD CONSTRAINT "process_project_label_spec_project_step_id_process_project_spec_step_id_fk" FOREIGN KEY ("project_step_id") REFERENCES "public"."process_project_spec"("step_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_project_label_spec" ADD CONSTRAINT "process_project_label_spec_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_project_label_spec" ADD CONSTRAINT "process_project_label_spec_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_project_spec" ADD CONSTRAINT "process_project_spec_step_id_process_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."process_step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_project_spec" ADD CONSTRAINT "process_project_spec_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_project_spec" ADD CONSTRAINT "process_project_spec_lead_id_actor_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_project_spec" ADD CONSTRAINT "process_project_spec_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_project_spec" ADD CONSTRAINT "process_project_spec_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_revision" ADD CONSTRAINT "process_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_revision" ADD CONSTRAINT "process_revision_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_revision" ADD CONSTRAINT "process_revision_definition_id_process_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."process_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step" ADD CONSTRAINT "process_step_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step" ADD CONSTRAINT "process_step_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step" ADD CONSTRAINT "process_step_revision_id_process_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."process_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step" ADD CONSTRAINT "process_step_after_step_fk" FOREIGN KEY ("after_step_id") REFERENCES "public"."process_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_label_spec" ADD CONSTRAINT "process_task_label_spec_task_step_id_process_task_spec_step_id_fk" FOREIGN KEY ("task_step_id") REFERENCES "public"."process_task_spec"("step_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_label_spec" ADD CONSTRAINT "process_task_label_spec_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_label_spec" ADD CONSTRAINT "process_task_label_spec_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_step_id_process_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."process_step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_assignee_id_actor_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_project_step_id_process_project_spec_step_id_fk" FOREIGN KEY ("project_step_id") REFERENCES "public"."process_project_spec"("step_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_milestone_step_id_process_milestone_spec_step_id_fk" FOREIGN KEY ("milestone_step_id") REFERENCES "public"."process_milestone_spec"("step_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_parent_task_id_task_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_parent_fk" FOREIGN KEY ("parent_task_step_id") REFERENCES "public"."process_task_spec"("step_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_exception" ADD CONSTRAINT "recurrence_exception_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_exception" ADD CONSTRAINT "recurrence_exception_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_exception" ADD CONSTRAINT "recurrence_exception_series_revision_id_recurrence_series_revision_id_fk" FOREIGN KEY ("series_revision_id") REFERENCES "public"."recurrence_series_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_series" ADD CONSTRAINT "recurrence_series_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_series" ADD CONSTRAINT "recurrence_series_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_series" ADD CONSTRAINT "recurrence_series_definition_id_process_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."process_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_series_revision" ADD CONSTRAINT "recurrence_series_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_series_revision" ADD CONSTRAINT "recurrence_series_revision_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_series_revision" ADD CONSTRAINT "recurrence_series_revision_series_id_recurrence_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurrence_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_series_revision" ADD CONSTRAINT "recurrence_series_revision_process_revision_id_process_revision_id_fk" FOREIGN KEY ("process_revision_id") REFERENCES "public"."process_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_series_weekday" ADD CONSTRAINT "recurrence_series_weekday_series_revision_id_recurrence_series_revision_id_fk" FOREIGN KEY ("series_revision_id") REFERENCES "public"."recurrence_series_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_process_binding_series_uq" ON "calendar_process_binding" USING btree ("organization_id","calendar_layer_id","external_series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_process_binding_recurrence_series_uq" ON "calendar_process_binding" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "process_definition_org_status_idx" ON "process_definition" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "process_dependency_org_revision_idx" ON "process_dependency" USING btree ("organization_id","revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_instance_occurrence_uq" ON "process_instance" USING btree ("occurrence_id") WHERE "process_instance"."occurrence_id" is not null;--> statement-breakpoint
CREATE INDEX "process_instance_org_status_idx" ON "process_instance" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "process_instance_milestone_instance_step_uq" ON "process_instance_milestone" USING btree ("instance_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_instance_milestone_milestone_uq" ON "process_instance_milestone" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "process_instance_milestone_org_idx" ON "process_instance_milestone" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_instance_project_instance_step_uq" ON "process_instance_project" USING btree ("instance_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_instance_project_project_uq" ON "process_instance_project" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "process_instance_project_org_idx" ON "process_instance_project" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_instance_task_instance_step_uq" ON "process_instance_task" USING btree ("instance_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_instance_task_task_uq" ON "process_instance_task" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "process_instance_task_org_idx" ON "process_instance_task" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "process_milestone_spec_org_project_idx" ON "process_milestone_spec" USING btree ("organization_id","project_step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_occurrence_revision_date_uq" ON "process_occurrence" USING btree ("series_id","series_revision_id","scheduled_for") WHERE "process_occurrence"."external_occurrence_key" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "process_occurrence_series_external_uq" ON "process_occurrence" USING btree ("series_id","external_occurrence_key") WHERE "process_occurrence"."external_occurrence_key" is not null;--> statement-breakpoint
CREATE INDEX "process_occurrence_org_status_date_idx" ON "process_occurrence" USING btree ("organization_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "process_project_label_spec_org_idx" ON "process_project_label_spec" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "process_project_spec_org_idx" ON "process_project_spec" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_revision_definition_number_uq" ON "process_revision" USING btree ("definition_id","number");--> statement-breakpoint
CREATE INDEX "process_revision_org_definition_idx" ON "process_revision" USING btree ("organization_id","definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_step_revision_key_uq" ON "process_step" USING btree ("revision_id","key");--> statement-breakpoint
CREATE INDEX "process_step_org_revision_idx" ON "process_step" USING btree ("organization_id","revision_id");--> statement-breakpoint
CREATE INDEX "process_task_label_spec_org_idx" ON "process_task_label_spec" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "process_task_spec_org_team_idx" ON "process_task_spec" USING btree ("organization_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurrence_exception_revision_date_uq" ON "recurrence_exception" USING btree ("series_revision_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "recurrence_exception_org_revision_idx" ON "recurrence_exception" USING btree ("organization_id","series_revision_id");--> statement-breakpoint
CREATE INDEX "recurrence_series_org_status_idx" ON "recurrence_series" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "recurrence_series_revision_series_number_uq" ON "recurrence_series_revision" USING btree ("series_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "recurrence_series_revision_series_effective_uq" ON "recurrence_series_revision" USING btree ("series_id","effective_from");--> statement-breakpoint
CREATE INDEX "recurrence_series_revision_org_series_idx" ON "recurrence_series_revision" USING btree ("organization_id","series_id");