CREATE TABLE "day_boundary_extension_request" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"date" text NOT NULL,
	"deadline_key" text NOT NULL,
	"requested_minutes" integer NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"external_request_id" text,
	"detail" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "day_boundary_extension_request" ADD CONSTRAINT "day_boundary_extension_request_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "day_boundary_ext_hub_date_deadline_uq" ON "day_boundary_extension_request" USING btree ("hub_id","date","deadline_key");--> statement-breakpoint
CREATE INDEX "day_boundary_ext_hub_date_idx" ON "day_boundary_extension_request" USING btree ("hub_id","date");