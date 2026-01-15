CREATE TYPE "public"."initiative_status_category" AS ENUM('planning', 'active', 'completed', 'archived');--> statement-breakpoint
CREATE TABLE "custom_initiative_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "initiative_status_category" NOT NULL,
	"color" text NOT NULL,
	"icon" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "status_id" text;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "status_category" "initiative_status_category" DEFAULT 'planning' NOT NULL;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "is_strategic_priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_initiative_statuses" ADD CONSTRAINT "custom_initiative_statuses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_status_id_custom_initiative_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."custom_initiative_statuses"("id") ON DELETE set null ON UPDATE no action;