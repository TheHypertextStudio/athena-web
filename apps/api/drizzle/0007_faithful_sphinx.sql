CREATE TYPE "public"."task_status_category" AS ENUM('not_started', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'google_tasks' BEFORE 'google_calendar';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'microsoft_todo' BEFORE 'google_calendar';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'apple_reminders' BEFORE 'google_calendar';--> statement-breakpoint
CREATE TABLE "custom_task_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "task_status_category" NOT NULL,
	"color" text NOT NULL,
	"icon" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "status_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "status_category" "task_status_category" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_task_statuses" ADD CONSTRAINT "custom_task_statuses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_id_custom_task_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."custom_task_statuses"("id") ON DELETE set null ON UPDATE no action;