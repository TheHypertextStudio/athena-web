CREATE TYPE "public"."document_image_subject_type" AS ENUM('task', 'project', 'program', 'initiative', 'team', 'milestone', 'comment', 'update', 'template');--> statement-breakpoint
CREATE TABLE "document_image_reference" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"image_id" text NOT NULL,
	"subject_type" "document_image_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"field" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_image_reference" ADD CONSTRAINT "document_image_reference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_image_reference" ADD CONSTRAINT "document_image_reference_image_id_document_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."document_image"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_image_reference_inline_uq" ON "document_image_reference" USING btree ("organization_id","subject_type","subject_id","field","position");--> statement-breakpoint
CREATE INDEX "document_image_reference_image_idx" ON "document_image_reference" USING btree ("organization_id","image_id");--> statement-breakpoint
CREATE INDEX "document_image_reference_subject_idx" ON "document_image_reference" USING btree ("organization_id","subject_type","subject_id");