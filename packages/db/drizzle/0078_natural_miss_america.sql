CREATE TYPE "public"."notion_mirror_entity" AS ENUM('task', 'project', 'initiative', 'program', 'team', 'cycle', 'milestone', 'label', 'person');--> statement-breakpoint
ALTER TYPE "public"."sync_run_purpose" ADD VALUE IF NOT EXISTS 'notion_mirror';--> statement-breakpoint
CREATE TABLE "notion_mirror_database" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"integration_id" text NOT NULL,
	"entity_type" "notion_mirror_entity" NOT NULL,
	"title" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"external_database_id" text,
	"external_data_source_id" text,
	"external_url" text,
	"property_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"provisioned_at" timestamp,
	"last_pushed_at" timestamp,
	"last_pulled_at" timestamp,
	"row_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notion_mirror_row" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"entity_type" "notion_mirror_entity" NOT NULL,
	"entity_id" text NOT NULL,
	"external_page_id" text NOT NULL,
	"external_updated_at" timestamp,
	"last_pushed_at" timestamp,
	"content_hash" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notion_mirror_database" ADD CONSTRAINT "notion_mirror_database_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_mirror_database" ADD CONSTRAINT "notion_mirror_database_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_mirror_database" ADD CONSTRAINT "notion_mirror_database_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_mirror_row" ADD CONSTRAINT "notion_mirror_row_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_mirror_row" ADD CONSTRAINT "notion_mirror_row_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notion_mirror_database_org_idx" ON "notion_mirror_database" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notion_mirror_database_entity_uq" ON "notion_mirror_database" USING btree ("integration_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "notion_mirror_row_entity_uq" ON "notion_mirror_row" USING btree ("integration_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notion_mirror_row_page_uq" ON "notion_mirror_row" USING btree ("integration_id","external_page_id");--> statement-breakpoint
CREATE INDEX "notion_mirror_row_lookup_idx" ON "notion_mirror_row" USING btree ("organization_id","entity_type","entity_id");
