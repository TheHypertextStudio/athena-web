CREATE TYPE "public"."initiative_priority" AS ENUM('none', 'low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."initiative_update_cadence" AS ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'none');--> statement-breakpoint
ALTER TYPE "public"."attachment_subject_type" ADD VALUE 'initiative';--> statement-breakpoint
ALTER TYPE "public"."initiative_status" ADD VALUE 'proposed' BEFORE 'active';--> statement-breakpoint
ALTER TYPE "public"."initiative_status" ADD VALUE 'canceled';--> statement-breakpoint
CREATE TABLE "initiative_hierarchy_link" (
	"id" text PRIMARY KEY NOT NULL,
	"context_organization_id" text NOT NULL,
	"parent_initiative_id" text NOT NULL,
	"child_initiative_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_hierarchy_no_self" CHECK ("initiative_hierarchy_link"."parent_initiative_id" <> "initiative_hierarchy_link"."child_initiative_id")
);
--> statement-breakpoint
CREATE TABLE "initiative_label" (
	"initiative_id" text NOT NULL,
	"label_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "initiative_label_initiative_id_label_id_pk" PRIMARY KEY("initiative_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "initiative_max_depth" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "priority" "initiative_priority" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "update_cadence" "initiative_update_cadence" DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative_hierarchy_link" ADD CONSTRAINT "initiative_hierarchy_link_context_organization_id_organization_id_fk" FOREIGN KEY ("context_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_hierarchy_link" ADD CONSTRAINT "initiative_hierarchy_link_parent_initiative_id_initiative_id_fk" FOREIGN KEY ("parent_initiative_id") REFERENCES "public"."initiative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_hierarchy_link" ADD CONSTRAINT "initiative_hierarchy_link_child_initiative_id_initiative_id_fk" FOREIGN KEY ("child_initiative_id") REFERENCES "public"."initiative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_hierarchy_link" ADD CONSTRAINT "initiative_hierarchy_link_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_label" ADD CONSTRAINT "initiative_label_initiative_id_initiative_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_label" ADD CONSTRAINT "initiative_label_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_label" ADD CONSTRAINT "initiative_label_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "initiative_hierarchy_context_child_uq" ON "initiative_hierarchy_link" USING btree ("context_organization_id","child_initiative_id");--> statement-breakpoint
CREATE INDEX "initiative_hierarchy_context_parent_idx" ON "initiative_hierarchy_link" USING btree ("context_organization_id","parent_initiative_id");--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_initiative_max_depth_check" CHECK ("organization"."initiative_max_depth" between 1 and 5);