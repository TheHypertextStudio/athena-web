CREATE TABLE "notion_linked_page_state" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"task_id" text NOT NULL,
	"external_page_id" text NOT NULL,
	"property_anchors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_hash" text,
	"body_state" text DEFAULT 'complete' NOT NULL,
	"body_unknown_block_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notion_mirror_row" ADD COLUMN "property_anchors" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notion_mirror_row" ADD COLUMN "body_hash" text;--> statement-breakpoint
ALTER TABLE "notion_mirror_row" ADD COLUMN "body_state" text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE "notion_mirror_row" ADD COLUMN "body_unknown_block_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notion_linked_page_state" ADD CONSTRAINT "notion_linked_page_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_linked_page_state" ADD CONSTRAINT "notion_linked_page_state_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notion_linked_page_state_page_uq" ON "notion_linked_page_state" USING btree ("integration_id","external_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notion_linked_page_state_task_uq" ON "notion_linked_page_state" USING btree ("integration_id","task_id");--> statement-breakpoint
CREATE INDEX "notion_linked_page_state_org_idx" ON "notion_linked_page_state" USING btree ("organization_id");