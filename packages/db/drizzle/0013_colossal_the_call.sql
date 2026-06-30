CREATE TYPE "public"."email_suggestion_status" AS ENUM('pending', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TABLE "automation_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"event_match" jsonb NOT NULL,
	"condition" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"is_seed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"integration_id" text NOT NULL,
	"external_thread_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp,
	"priority" "task_priority" DEFAULT 'none' NOT NULL,
	"suggested_project_id" text,
	"suggested_program_id" text,
	"confidence" integer,
	"status" "email_suggestion_status" DEFAULT 'pending' NOT NULL,
	"email_meta" jsonb,
	"created_task_id" text
);
--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suggestion" ADD CONSTRAINT "email_suggestion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suggestion" ADD CONSTRAINT "email_suggestion_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suggestion" ADD CONSTRAINT "email_suggestion_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rule_org_idx" ON "automation_rule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "email_suggestion_org_status_idx" ON "email_suggestion" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_suggestion_thread_uq" ON "email_suggestion" USING btree ("organization_id","external_thread_id");