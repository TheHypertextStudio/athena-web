CREATE TABLE "notion_mirror_state" (
	"integration_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"desired_generation" bigint DEFAULT 0 NOT NULL,
	"applied_generation" bigint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"last_success_at" timestamp,
	"last_error_kind" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notion_mirror_state" ADD CONSTRAINT "notion_mirror_state_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_mirror_state" ADD CONSTRAINT "notion_mirror_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notion_mirror_state_org_idx" ON "notion_mirror_state" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notion_mirror_state_due_idx" ON "notion_mirror_state" USING btree ("next_attempt_at");--> statement-breakpoint
ALTER TABLE "notion_mirror_database" ADD COLUMN "provisioning_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "notion_mirror_row" ALTER COLUMN "external_page_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notion_mirror_database" ADD COLUMN "docket_id_property_id" text;
