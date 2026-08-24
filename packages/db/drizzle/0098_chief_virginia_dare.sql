CREATE TYPE "public"."object_command_effect_status" AS ENUM('pending', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "object_command_effect_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"command_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"next_effect" integer DEFAULT 0 NOT NULL,
	"status" "object_command_effect_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "object_command_effect_job" ADD CONSTRAINT "object_command_effect_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_command_effect_job" ADD CONSTRAINT "object_command_effect_job_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "object_command_effect_job_command_uq" ON "object_command_effect_job" USING btree ("organization_id","actor_id","command_id");--> statement-breakpoint
CREATE INDEX "object_command_effect_job_status_run_idx" ON "object_command_effect_job" USING btree ("status","run_after","created_at");--> statement-breakpoint
CREATE INDEX "object_command_effect_job_status_processed_idx" ON "object_command_effect_job" USING btree ("status","processed_at");