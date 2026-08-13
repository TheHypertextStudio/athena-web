CREATE TABLE "document_image" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"blob_key" text NOT NULL,
	"file_name" text,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_image" ADD CONSTRAINT "document_image_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_image" ADD CONSTRAINT "document_image_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_image_org_idx" ON "document_image" USING btree ("organization_id");