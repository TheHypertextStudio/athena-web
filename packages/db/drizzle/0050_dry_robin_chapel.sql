CREATE TYPE "public"."change_set_op" AS ENUM('create', 'update', 'archive', 'link');--> statement-breakpoint
CREATE TABLE "change_set" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"origin" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"undone_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "change_set_entry" (
	"change_set_id" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"op" "change_set_op" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	CONSTRAINT "change_set_entry_change_set_id_entity_kind_entity_id_pk" PRIMARY KEY("change_set_id","entity_kind","entity_id")
);
--> statement-breakpoint
ALTER TABLE "change_set" ADD CONSTRAINT "change_set_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_set" ADD CONSTRAINT "change_set_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_set_entry" ADD CONSTRAINT "change_set_entry_change_set_id_change_set_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_set_org_created_idx" ON "change_set" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "change_set_actor_idx" ON "change_set" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "change_set_entry_entity_idx" ON "change_set_entry" USING btree ("entity_kind","entity_id");