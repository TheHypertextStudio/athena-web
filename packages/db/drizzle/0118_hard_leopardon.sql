CREATE TABLE "service_control" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_control_key_check" CHECK ("service_control"."key" IN ('lattice_submissions', 'lattice_polling'))
);
--> statement-breakpoint
ALTER TABLE "service_control" ADD CONSTRAINT "service_control_updated_by_staff_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_user"("id") ON DELETE set null ON UPDATE no action;