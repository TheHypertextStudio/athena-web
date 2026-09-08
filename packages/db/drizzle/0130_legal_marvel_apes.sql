CREATE TABLE "work_location_geocode_rate_limit" (
	"user_id" text PRIMARY KEY NOT NULL,
	"request_timestamps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_location_geocode_rate_limit" ADD CONSTRAINT "work_location_geocode_rate_limit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;