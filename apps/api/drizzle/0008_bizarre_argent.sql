ALTER TYPE "public"."integration_provider" ADD VALUE 'caldav_calendar' BEFORE 'slack';--> statement-breakpoint
CREATE TABLE "app_passwords" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{"caldav","carddav"}' NOT NULL,
	"last_used_at" timestamp,
	"last_used_ip" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#4285F4',
	"timezone" text DEFAULT 'UTC',
	"ctag" text NOT NULL,
	"sync_token" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_read_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"calendar_id" text NOT NULL,
	"event_id" text NOT NULL,
	"change_type" text NOT NULL,
	"sync_token" integer NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "calendar_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "etag" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "calendar_status" text DEFAULT 'CONFIRMED';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "transparency" text DEFAULT 'OPAQUE';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "classification" text DEFAULT 'PUBLIC';--> statement-breakpoint
ALTER TABLE "linked_integrations" ADD COLUMN "account_label" text;--> statement-breakpoint
ALTER TABLE "linked_integrations" ADD COLUMN "account_email" text;--> statement-breakpoint
ALTER TABLE "linked_integrations" ADD COLUMN "account_color" text;--> statement-breakpoint
ALTER TABLE "linked_integrations" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "linked_integrations" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_passwords" ADD CONSTRAINT "app_passwords_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_changes" ADD CONSTRAINT "event_changes_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_passwords_user_idx" ON "app_passwords" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendars_user_idx" ON "calendars" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_changes_calendar_sync_idx" ON "event_changes" USING btree ("calendar_id","sync_token");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_calendar_idx" ON "events" USING btree ("calendar_id");--> statement-breakpoint
CREATE INDEX "events_etag_idx" ON "events" USING btree ("etag");