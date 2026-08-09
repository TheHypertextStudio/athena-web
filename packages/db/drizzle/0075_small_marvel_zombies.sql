CREATE TABLE "label_group" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"exclusive" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"team_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_label" (
	"program_id" text NOT NULL,
	"label_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "program_label_program_id_label_id_pk" PRIMARY KEY("program_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "resource_label" (
	"resource_id" text NOT NULL,
	"label_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "resource_label_resource_id_label_id_pk" PRIMARY KEY("resource_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "label" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "label_group" ADD CONSTRAINT "label_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_group" ADD CONSTRAINT "label_group_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_label" ADD CONSTRAINT "program_label_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_label" ADD CONSTRAINT "program_label_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_label" ADD CONSTRAINT "program_label_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_label" ADD CONSTRAINT "resource_label_resource_id_external_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."external_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_label" ADD CONSTRAINT "resource_label_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_label" ADD CONSTRAINT "resource_label_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "label_group_org_name_global_uq" ON "label_group" USING btree ("organization_id","name") WHERE "label_group"."team_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "label_group_team_name_uq" ON "label_group" USING btree ("team_id","name") WHERE "label_group"."team_id" is not null;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_group_id_label_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."label_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_org_group_idx" ON "label" USING btree ("organization_id","group_id");