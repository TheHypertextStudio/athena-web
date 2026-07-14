CREATE TABLE "entity_display" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"icon_key" text NOT NULL,
	"color_key" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_display_subject_type_check" CHECK ("entity_display"."subject_type" in ('initiative', 'project')),
	CONSTRAINT "entity_display_icon_key_check" CHECK ("entity_display"."icon_key" in ('target', 'flag', 'layers', 'folder', 'workflow', 'globe', 'users', 'sparkles')),
	CONSTRAINT "entity_display_color_key_check" CHECK ("entity_display"."color_key" in ('neutral', 'primary', 'success', 'warning', 'danger'))
);
--> statement-breakpoint
ALTER TABLE "entity_display" ADD CONSTRAINT "entity_display_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_display" ADD CONSTRAINT "entity_display_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_display_subject_uq" ON "entity_display" USING btree ("organization_id","subject_type","subject_id");