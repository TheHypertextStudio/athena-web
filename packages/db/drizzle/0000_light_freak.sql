CREATE TYPE "public"."actor_kind" AS ENUM('human', 'agent', 'team');--> statement-breakpoint
CREATE TYPE "public"."actor_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."approval_policy" AS ENUM('suggest', 'act_with_approval', 'autonomous');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('proposed', 'approved', 'rejected', 'applied');--> statement-breakpoint
CREATE TYPE "public"."audit_event_type" AS ENUM('created', 'updated', 'state_changed', 'assigned', 'commented', 'archived', 'deleted', 'moved', 'linked', 'member_added', 'member_removed', 'role_changed', 'grant_changed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."audit_subject_type" AS ENUM('organization', 'team', 'initiative', 'program', 'project', 'cycle', 'task', 'actor', 'agent', 'agent_session', 'comment', 'update', 'integration', 'role', 'grant', 'membership');--> statement-breakpoint
CREATE TYPE "public"."comment_subject_type" AS ENUM('task', 'project', 'program', 'initiative', 'cycle');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('upcoming', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."daily_plan_item_status" AS ENUM('planned', 'done');--> statement-breakpoint
CREATE TYPE "public"."grant_capability" AS ENUM('view', 'comment', 'contribute', 'assign', 'manage');--> statement-breakpoint
CREATE TYPE "public"."grant_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."grant_subject_kind" AS ENUM('actor', 'role');--> statement-breakpoint
CREATE TYPE "public"."health" AS ENUM('on_track', 'at_risk', 'off_track');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."initiative_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."integration_pattern" AS ENUM('migration', 'connector');--> statement-breakpoint
CREATE TYPE "public"."integration_role" AS ENUM('work', 'context', 'signal', 'time', 'code');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('pending', 'connected', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('mention', 'assignment', 'approval_request', 'status_change', 'comment', 'invitation', 'agent_session');--> statement-breakpoint
CREATE TYPE "public"."org_lifecycle_state" AS ENUM('trialing', 'active', 'past_due', 'export_window', 'pending_deletion', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planned', 'active', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."provenance_source" AS ENUM('native', 'linked');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('organization', 'team', 'initiative', 'program', 'project', 'cycle', 'task');--> statement-breakpoint
CREATE TYPE "public"."session_activity_type" AS ENUM('thought', 'action', 'response', 'elicitation', 'error');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('pending', 'running', 'awaiting_input', 'awaiting_approval', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."session_trigger" AS ENUM('assignment', 'delegation', 'mention');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('support', 'finance', 'superadmin');--> statement-breakpoint
CREATE TYPE "public"."sync_mode" AS ENUM('import', 'mirror');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('none', 'urgent', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."update_subject_type" AS ENUM('project', 'program', 'initiative');--> statement-breakpoint
CREATE TYPE "public"."view_scope" AS ENUM('personal', 'team', 'organization');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp DEFAULT now(),
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actor" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "actor_kind" NOT NULL,
	"display_name" text NOT NULL,
	"avatar" text,
	"status" "actor_status" DEFAULT 'active' NOT NULL,
	"user_id" text,
	"role_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "hub" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role_id" text NOT NULL,
	"as_guest" boolean DEFAULT false NOT NULL,
	"token" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"avatar" text,
	"is_personal" boolean DEFAULT false NOT NULL,
	"vocabulary" jsonb DEFAULT '{"preset":"startup"}'::jsonb NOT NULL,
	"agent_guidance" text,
	"approval_routing" jsonb,
	"lifecycle_state" "org_lifecycle_state" DEFAULT 'trialing' NOT NULL,
	"export_ready_at" timestamp,
	"delete_after_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"workflow_states" jsonb DEFAULT '[{"key":"backlog","name":"Backlog","type":"backlog","position":0},{"key":"todo","name":"Todo","type":"unstarted","position":1},{"key":"in_progress","name":"In Progress","type":"started","position":2},{"key":"done","name":"Done","type":"completed","position":3},{"key":"canceled","name":"Canceled","type":"canceled","position":4}]'::jsonb NOT NULL,
	"triage_enabled" boolean DEFAULT true NOT NULL,
	"agent_guidance" text,
	"approval_routing" jsonb,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"ancestor_path" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"team_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "team_member_team_id_actor_id_pk" PRIMARY KEY("team_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text,
	"initiator_id" text,
	"subject_type" "audit_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"type" "audit_event_type" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"author_id" text,
	"subject_type" "comment_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"body" text NOT NULL,
	"parent_comment_id" text,
	"edited_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "daily_plan_item" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"ref_organization_id" text NOT NULL,
	"ref_task_id" text NOT NULL,
	"date" date NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "daily_plan_item_status" DEFAULT 'planned' NOT NULL,
	"timebox_starts_at" timestamp,
	"timebox_ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subject_kind" "grant_subject_kind" NOT NULL,
	"subject_id" text NOT NULL,
	"resource_kind" "resource_kind" NOT NULL,
	"resource_id" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"effect" "grant_effect" DEFAULT 'allow' NOT NULL,
	"cascades" boolean DEFAULT true NOT NULL,
	"visibility_override" "visibility",
	"expires_at" timestamp,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"provider" text NOT NULL,
	"pattern" "integration_pattern" NOT NULL,
	"roles" "integration_role"[] DEFAULT '{}' NOT NULL,
	"connection" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "integration_status" DEFAULT 'pending' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sync_mode" "sync_mode" DEFAULT 'mirror' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"group" text,
	"team_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"type" "notification_type" NOT NULL,
	"body" jsonb NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_capability" "grant_capability",
	"default_visibility" "visibility" DEFAULT 'public' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"name" text NOT NULL,
	"scope" "view_scope" DEFAULT 'personal' NOT NULL,
	"owner_actor_id" text,
	"team_id" text,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grouping" jsonb,
	"sort" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "update" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"author_id" text,
	"subject_type" "update_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"health" "health",
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"team_id" text NOT NULL,
	"number" integer NOT NULL,
	"name" text,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" "cycle_status" DEFAULT 'upcoming' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "initiative" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"name" text NOT NULL,
	"description" text,
	"owner_id" text,
	"status" "initiative_status" DEFAULT 'active' NOT NULL,
	"target_date" timestamp,
	"health" "health"
);
--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"target_date" timestamp,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"name" text NOT NULL,
	"description" text,
	"owner_id" text,
	"status" "program_status" DEFAULT 'active' NOT NULL,
	"health" "health",
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"ancestor_path" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"name" text NOT NULL,
	"description" text,
	"lead_id" text,
	"program_id" text,
	"team_id" text,
	"status" "project_status" DEFAULT 'planned' NOT NULL,
	"health" "health",
	"start_date" timestamp,
	"target_date" timestamp,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"ancestor_path" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"title" text NOT NULL,
	"description" text,
	"team_id" text NOT NULL,
	"state" text NOT NULL,
	"priority" "task_priority" DEFAULT 'none' NOT NULL,
	"assignee_id" text,
	"delegate_id" text,
	"project_id" text,
	"program_id" text,
	"milestone_id" text,
	"cycle_id" text,
	"parent_task_id" text,
	"estimate" integer,
	"due_date" timestamp,
	"source" "provenance_source" DEFAULT 'native' NOT NULL,
	"source_integration_id" text,
	"external_id" text,
	"external_url" text,
	"source_sync_mode" "sync_mode",
	"completed_at" timestamp,
	"canceled_at" timestamp,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"ancestor_path" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "initiative_program" (
	"initiative_id" text NOT NULL,
	"program_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "initiative_program_initiative_id_program_id_pk" PRIMARY KEY("initiative_id","program_id")
);
--> statement-breakpoint
CREATE TABLE "initiative_project" (
	"initiative_id" text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "initiative_project_initiative_id_project_id_pk" PRIMARY KEY("initiative_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "task_dependency" (
	"blocking_task_id" text NOT NULL,
	"blocked_task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "task_dependency_blocking_task_id_blocked_task_id_pk" PRIMARY KEY("blocking_task_id","blocked_task_id"),
	CONSTRAINT "task_dependency_no_self" CHECK ("task_dependency"."blocking_task_id" <> "task_dependency"."blocked_task_id")
);
--> statement-breakpoint
CREATE TABLE "task_label" (
	"task_id" text NOT NULL,
	"label_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "task_label_task_id_label_id_pk" PRIMARY KEY("task_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"actor_id" text NOT NULL,
	"connection" jsonb,
	"approval_policy" "approval_policy" DEFAULT 'act_with_approval' NOT NULL,
	"accountable_owner_id" text,
	"guidance" text,
	"approval_routing" jsonb
);
--> statement-breakpoint
CREATE TABLE "agent_session" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"task_id" text,
	"trigger" "session_trigger" NOT NULL,
	"status" "session_status" DEFAULT 'pending' NOT NULL,
	"initiator_id" text,
	"external_run_ref" text,
	"started_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" "session_activity_type" NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approval_status" "approval_status",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impersonation_session" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_user_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "lifecycle_hold" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"reason" text NOT NULL,
	"placed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"released_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "operator_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_user_id" text,
	"type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_user" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"organization_id" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"status" "idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_key_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor" ADD CONSTRAINT "actor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor" ADD CONSTRAINT "actor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor" ADD CONSTRAINT "actor_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub" ADD CONSTRAINT "hub_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_actor_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_initiator_id_actor_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_actor_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_plan_item" ADD CONSTRAINT "daily_plan_item_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_plan_item" ADD CONSTRAINT "daily_plan_item_ref_organization_id_organization_id_fk" FOREIGN KEY ("ref_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant" ADD CONSTRAINT "grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant" ADD CONSTRAINT "grant_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_actor_id_actor_id_fk" FOREIGN KEY ("owner_actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update" ADD CONSTRAINT "update_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update" ADD CONSTRAINT "update_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update" ADD CONSTRAINT "update_author_id_actor_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_owner_id_actor_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_owner_id_actor_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_lead_id_actor_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_actor_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_delegate_id_actor_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_source_integration_id_integration_id_fk" FOREIGN KEY ("source_integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_program" ADD CONSTRAINT "initiative_program_initiative_id_initiative_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_program" ADD CONSTRAINT "initiative_program_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_program" ADD CONSTRAINT "initiative_program_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_project" ADD CONSTRAINT "initiative_project_initiative_id_initiative_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_project" ADD CONSTRAINT "initiative_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_project" ADD CONSTRAINT "initiative_project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_blocking_task_id_task_id_fk" FOREIGN KEY ("blocking_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_blocked_task_id_task_id_fk" FOREIGN KEY ("blocked_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label" ADD CONSTRAINT "task_label_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label" ADD CONSTRAINT "task_label_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label" ADD CONSTRAINT "task_label_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_accountable_owner_id_actor_id_fk" FOREIGN KEY ("accountable_owner_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_initiator_id_actor_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_activity" ADD CONSTRAINT "session_activity_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_activity" ADD CONSTRAINT "session_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_session" ADD CONSTRAINT "impersonation_session_staff_user_id_staff_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_session" ADD CONSTRAINT "impersonation_session_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_hold" ADD CONSTRAINT "lifecycle_hold_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_hold" ADD CONSTRAINT "lifecycle_hold_placed_by_staff_user_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."staff_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_audit_event" ADD CONSTRAINT "operator_audit_event_staff_user_id_staff_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_user" ADD CONSTRAINT "staff_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_uq" ON "session" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_uq" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "actor_org_idx" ON "actor" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "actor_org_user_uq" ON "actor" USING btree ("organization_id","user_id") WHERE "actor"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "hub_user_id_uq" ON "hub" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_uq" ON "invitation" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_org_email_pending_uq" ON "invitation" USING btree ("organization_id","email") WHERE "invitation"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitation_org_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uq" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organization_lifecycle_idx" ON "organization" USING btree ("lifecycle_state");--> statement-breakpoint
CREATE INDEX "team_org_idx" ON "team" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_org_key_uq" ON "team" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "team_ancestor_path_gin" ON "team" USING gin ("ancestor_path");--> statement-breakpoint
CREATE INDEX "team_member_actor_idx" ON "team_member" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_event_org_created_idx" ON "audit_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_subject_idx" ON "audit_event" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "comment_subject_idx" ON "comment" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "daily_plan_item_hub_date_idx" ON "daily_plan_item" USING btree ("hub_id","date");--> statement-breakpoint
CREATE INDEX "grant_org_idx" ON "grant" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "grant_subject_idx" ON "grant" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "grant_resource_idx" ON "grant" USING btree ("resource_kind","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grant_subject_resource_effect_uq" ON "grant" USING btree ("organization_id","subject_kind","subject_id","resource_kind","resource_id","effect");--> statement-breakpoint
CREATE INDEX "integration_org_idx" ON "integration" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_org_name_global_uq" ON "label" USING btree ("organization_id","name") WHERE "label"."team_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "label_team_name_uq" ON "label" USING btree ("team_id","name") WHERE "label"."team_id" is not null;--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "role_org_key_uq" ON "role" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "role_org_name_uq" ON "role" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "saved_view_org_idx" ON "saved_view" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "update_subject_idx" ON "update" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "cycle_team_idx" ON "cycle" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_team_number_uq" ON "cycle" USING btree ("team_id","number");--> statement-breakpoint
CREATE INDEX "initiative_org_idx" ON "initiative" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "milestone_project_idx" ON "milestone" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "program_org_idx" ON "program" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "program_ancestor_path_gin" ON "program" USING gin ("ancestor_path");--> statement-breakpoint
CREATE INDEX "project_org_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_ancestor_path_gin" ON "project" USING gin ("ancestor_path");--> statement-breakpoint
CREATE INDEX "task_org_idx" ON "task" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "task_team_state_idx" ON "task" USING btree ("team_id","state");--> statement-breakpoint
CREATE INDEX "task_project_idx" ON "task" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_ancestor_path_gin" ON "task" USING gin ("ancestor_path");--> statement-breakpoint
CREATE UNIQUE INDEX "task_source_uq" ON "task" USING btree ("source_integration_id","external_id") WHERE "task"."source" = 'linked';--> statement-breakpoint
CREATE INDEX "task_dependency_blocked_idx" ON "task_dependency" USING btree ("blocked_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_actor_uq" ON "agent" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "agent_session_org_idx" ON "agent_session" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_session_agent_idx" ON "agent_session" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "session_activity_session_idx" ON "session_activity" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "impersonation_session_staff_idx" ON "impersonation_session" USING btree ("staff_user_id");--> statement-breakpoint
CREATE INDEX "lifecycle_hold_org_idx" ON "lifecycle_hold" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "operator_audit_event_created_idx" ON "operator_audit_event" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_user_uq" ON "staff_user" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_key" USING btree ("expires_at");
