ALTER TYPE "public"."attachment_kind" ADD VALUE 'calendar_event';--> statement-breakpoint
CREATE TABLE "calendar_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"external_account_id" text NOT NULL,
	"account_email" text,
	"account_name" text,
	"account_picture_url" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_synced_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"external_calendar_id" text NOT NULL,
	"external_event_id" text NOT NULL,
	"recurring_event_id" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"html_link" text,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"all_day_start_date" date,
	"all_day_end_date" date,
	"organizer" jsonb,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_external_at" timestamp,
	"etag" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_list" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"external_calendar_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"timezone" text,
	"color" text,
	"access_role" text,
	"primary" boolean DEFAULT false NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"visible_by_default" boolean DEFAULT true NOT NULL,
	"sync_token" text,
	"last_synced_at" timestamp,
	"last_error" text,
	"watch_channel_id" text,
	"watch_resource_id" text,
	"watch_token" text,
	"watch_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_connection" ADD CONSTRAINT "calendar_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_calendar_id_calendar_list_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendar_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_list" ADD CONSTRAINT "calendar_list_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_list" ADD CONSTRAINT "calendar_list_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_connection_user_idx" ON "calendar_connection" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connection_user_provider_account_uq" ON "calendar_connection" USING btree ("user_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "calendar_event_user_starts_idx" ON "calendar_event" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_event_user_all_day_idx" ON "calendar_event" USING btree ("user_id","all_day_start_date");--> statement-breakpoint
CREATE INDEX "calendar_event_connection_idx" ON "calendar_event" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_calendar_external_uq" ON "calendar_event" USING btree ("calendar_id","external_event_id");--> statement-breakpoint
CREATE INDEX "calendar_list_user_idx" ON "calendar_list" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendar_list_user_selected_idx" ON "calendar_list" USING btree ("user_id","selected");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_list_connection_external_uq" ON "calendar_list" USING btree ("connection_id","external_calendar_id");