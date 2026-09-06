CREATE TYPE "public"."plan_draft_status" AS ENUM('active', 'committed', 'archived');--> statement-breakpoint
CREATE TABLE "plan_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text,
	"root_initiative_id" text,
	"title" text NOT NULL,
	"status" "plan_draft_status" DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "plan_draft_title_not_blank" CHECK ("plan_draft"."title" ~ '[^[:space:]]')
);
--> statement-breakpoint
ALTER TABLE "plan_draft" ADD CONSTRAINT "plan_draft_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_draft" ADD CONSTRAINT "plan_draft_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_draft" ADD CONSTRAINT "plan_draft_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_draft" ADD CONSTRAINT "plan_draft_root_initiative_id_initiative_id_fk" FOREIGN KEY ("root_initiative_id") REFERENCES "public"."initiative"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_draft_owner_status_idx" ON "plan_draft" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "plan_draft_session_idx" ON "plan_draft" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_draft_owner_root_active_uq" ON "plan_draft" USING btree ("owner_user_id","root_initiative_id") WHERE "plan_draft"."status" = 'active' AND "plan_draft"."root_initiative_id" IS NOT NULL;