CREATE TYPE "public"."template_target_type" AS ENUM('task', 'project', 'initiative', 'program');--> statement-breakpoint
CREATE TABLE "template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"target_type" "template_target_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope" "view_scope" DEFAULT 'personal' NOT NULL,
	"owner_actor_id" text,
	"team_id" text,
	"payload" jsonb NOT NULL,
	"is_seed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "template_name_not_blank" CHECK ("template"."name" ~ '[^[:space:]]')
);
--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_owner_actor_id_actor_id_fk" FOREIGN KEY ("owner_actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_org_target_idx" ON "template" USING btree ("organization_id","target_type");