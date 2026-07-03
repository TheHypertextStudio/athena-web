CREATE TABLE "calendar_item" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"layer_id" text NOT NULL,
	"connection_id" text,
	"kind" text NOT NULL,
	"provider" text,
	"external_calendar_id" text,
	"external_event_id" text,
	"recurring_event_id" text,
	"recurrence_instance_key" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"html_link" text,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"all_day_start_date" date,
	"all_day_end_date" date,
	"timezone" text,
	"organizer" jsonb,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_raw" jsonb,
	"permissions" jsonb,
	"updated_external_at" timestamp,
	"external_etag" text,
	"external_sequence" integer,
	"last_pushed_at" timestamp,
	"sync_state" text DEFAULT 'clean' NOT NULL,
	"conflict" jsonb,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_item_task_link" (
	"calendar_item_id" text NOT NULL,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"role" text DEFAULT 'related' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"note" text,
	"item_title_snapshot" text,
	"item_starts_at_snapshot" timestamp,
	"item_ends_at_snapshot" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_item_task_link_calendar_item_id_task_id_pk" PRIMARY KEY("calendar_item_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_item_write" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"calendar_item_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"patch" jsonb NOT NULL,
	"base_external_etag" text,
	"base_updated_external_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_layer" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text,
	"provider" text,
	"source_kind" text NOT NULL,
	"external_layer_id" text,
	"title" text NOT NULL,
	"description" text,
	"timezone" text,
	"color" text,
	"access_role" text,
	"primary" boolean DEFAULT false NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"visible_by_default" boolean DEFAULT true NOT NULL,
	"editable_core" boolean DEFAULT false NOT NULL,
	"sync_token" text,
	"watch_channel_id" text,
	"watch_resource_id" text,
	"watch_token" text,
	"watch_expires_at" timestamp,
	"last_synced_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_connection" ADD COLUMN "scope_state" jsonb;--> statement-breakpoint
ALTER TABLE "calendar_item" ADD CONSTRAINT "calendar_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_item" ADD CONSTRAINT "calendar_item_layer_id_calendar_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."calendar_layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_item" ADD CONSTRAINT "calendar_item_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_item_task_link" ADD CONSTRAINT "calendar_item_task_link_calendar_item_id_calendar_item_id_fk" FOREIGN KEY ("calendar_item_id") REFERENCES "public"."calendar_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_item_task_link" ADD CONSTRAINT "calendar_item_task_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_item_task_link" ADD CONSTRAINT "calendar_item_task_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_item_task_link" ADD CONSTRAINT "calendar_item_task_link_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_item_write" ADD CONSTRAINT "calendar_item_write_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_item_write" ADD CONSTRAINT "calendar_item_write_calendar_item_id_calendar_item_id_fk" FOREIGN KEY ("calendar_item_id") REFERENCES "public"."calendar_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_item_write" ADD CONSTRAINT "calendar_item_write_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_layer" ADD CONSTRAINT "calendar_layer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_layer" ADD CONSTRAINT "calendar_layer_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_item_user_starts_idx" ON "calendar_item" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_item_user_all_day_idx" ON "calendar_item" USING btree ("user_id","all_day_start_date");--> statement-breakpoint
CREATE INDEX "calendar_item_layer_idx" ON "calendar_item" USING btree ("layer_id");--> statement-breakpoint
CREATE INDEX "calendar_item_user_sync_state_idx" ON "calendar_item" USING btree ("user_id","sync_state");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_item_layer_external_uq" ON "calendar_item" USING btree ("layer_id","external_event_id");--> statement-breakpoint
CREATE INDEX "calendar_item_task_link_org_task_idx" ON "calendar_item_task_link" USING btree ("organization_id","task_id");--> statement-breakpoint
CREATE INDEX "calendar_item_task_link_item_org_idx" ON "calendar_item_task_link" USING btree ("calendar_item_id","organization_id");--> statement-breakpoint
CREATE INDEX "calendar_item_write_item_idx" ON "calendar_item_write" USING btree ("calendar_item_id");--> statement-breakpoint
CREATE INDEX "calendar_item_write_status_next_idx" ON "calendar_item_write" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "calendar_layer_user_idx" ON "calendar_layer" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendar_layer_user_selected_idx" ON "calendar_layer" USING btree ("user_id","selected");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_layer_connection_external_uq" ON "calendar_layer" USING btree ("connection_id","external_layer_id");
--> statement-breakpoint
-- Backfill: project every existing calendar_list row into calendar_layer, reusing the
-- calendar_list row id as the layer id. This makes calendar_event.calendar_id a valid
-- calendar_layer.id for free (see the calendar_item backfill below) and is idempotent —
-- rerunning is a no-op via ON CONFLICT DO NOTHING.
INSERT INTO "calendar_layer" (
	"id", "user_id", "connection_id", "provider", "source_kind", "external_layer_id",
	"title", "description", "timezone", "color", "access_role", "primary", "selected",
	"visible_by_default", "editable_core", "sync_token", "watch_channel_id",
	"watch_resource_id", "watch_token", "watch_expires_at", "last_synced_at", "last_error",
	"created_at", "updated_at"
)
SELECT
	"id", "user_id", "connection_id", 'google', 'provider_calendar', "external_calendar_id",
	"title", "description", "timezone", "color", "access_role", "primary", "selected",
	"visible_by_default", false, "sync_token", "watch_channel_id", "watch_resource_id",
	"watch_token", "watch_expires_at", "last_synced_at", "last_error", "created_at",
	"updated_at"
FROM "calendar_list"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Backfill: project every existing calendar_event row into calendar_item, reusing the
-- calendar_event row id as the item id and calendar_event.calendar_id as the item's
-- layer_id (valid because calendar_layer ids reuse calendar_list ids above). Idempotent
-- via ON CONFLICT DO NOTHING.
INSERT INTO "calendar_item" (
	"id", "user_id", "layer_id", "connection_id", "kind", "provider",
	"external_calendar_id", "external_event_id", "recurring_event_id", "status", "title",
	"description", "location", "html_link", "starts_at", "ends_at", "all_day_start_date",
	"all_day_end_date", "organizer", "attendees", "updated_external_at", "external_etag",
	"sync_state", "archived_at", "created_at", "updated_at"
)
SELECT
	"id", "user_id", "calendar_id", "connection_id", 'provider_event', 'google',
	"external_calendar_id", "external_event_id", "recurring_event_id", "status", "title",
	"description", "location", "html_link", "starts_at", "ends_at", "all_day_start_date",
	"all_day_end_date", "organizer", "attendees", "updated_external_at", "etag",
	'clean', "archived_at", "created_at", "updated_at"
FROM "calendar_event"
ON CONFLICT ("id") DO NOTHING;