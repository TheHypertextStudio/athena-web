CREATE TYPE "public"."external_actor_match" AS ENUM('email', 'manual');--> statement-breakpoint
CREATE TABLE "external_actor" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"external_id" text NOT NULL,
	"email" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"actor_id" text,
	"matched_by" "external_actor_match",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "last_full_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "label" ADD COLUMN "source_integration_id" text;--> statement-breakpoint
ALTER TABLE "label" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "source" "provenance_source" DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "source_integration_id" text;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "external_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "source" "provenance_source" DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "source_integration_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "external_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "external_actor" ADD CONSTRAINT "external_actor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_actor" ADD CONSTRAINT "external_actor_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_actor" ADD CONSTRAINT "external_actor_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_actor_org_idx" ON "external_actor" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_actor_uq" ON "external_actor" USING btree ("integration_id","external_id");--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_source_integration_id_integration_id_fk" FOREIGN KEY ("source_integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_source_integration_id_integration_id_fk" FOREIGN KEY ("source_integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_source_integration_id_integration_id_fk" FOREIGN KEY ("source_integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "label_source_uq" ON "label" USING btree ("source_integration_id","external_id") WHERE "label"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_source_uq" ON "cycle" USING btree ("source_integration_id","external_id") WHERE "cycle"."source" = 'linked';--> statement-breakpoint
CREATE UNIQUE INDEX "project_source_uq" ON "project" USING btree ("source_integration_id","external_id") WHERE "project"."source" = 'linked';
