CREATE TABLE "work_location_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"place_id" text NOT NULL,
	"schedule" jsonb NOT NULL,
	"origin" text DEFAULT 'docket' NOT NULL,
	"origin_provider" text,
	"origin_connection_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"source_updated_at" timestamp,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_location_assertion_revision_positive" CHECK ("work_location_assertion"."revision" > 0),
	CONSTRAINT "work_location_assertion_origin_check" CHECK ("work_location_assertion"."origin" IN ('docket', 'provider'))
);
--> statement-breakpoint
CREATE TABLE "work_location_exception" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"assertion_id" text NOT NULL,
	"date" date NOT NULL,
	"action" text NOT NULL,
	"replacement_place_id" text,
	"replacement_schedule" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_location_exception_action_check" CHECK ("work_location_exception"."action" IN ('cancel', 'replace')),
	CONSTRAINT "work_location_exception_shape_check" CHECK ((
        "work_location_exception"."action" = 'cancel' AND "work_location_exception"."replacement_place_id" IS NULL AND "work_location_exception"."replacement_schedule" IS NULL
      ) OR (
        "work_location_exception"."action" = 'replace' AND "work_location_exception"."replacement_place_id" IS NOT NULL AND "work_location_exception"."replacement_schedule" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "work_location_observation" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"place_id" text NOT NULL,
	"source" text NOT NULL,
	"accuracy_meters" double precision,
	"observed_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_location_observation_source_check" CHECK ("work_location_observation"."source" IN ('manual', 'device')),
	CONSTRAINT "work_location_observation_accuracy_nonnegative" CHECK ("work_location_observation"."accuracy_meters" IS NULL OR "work_location_observation"."accuracy_meters" >= 0),
	CONSTRAINT "work_location_observation_time_check" CHECK ("work_location_observation"."expires_at" > "work_location_observation"."observed_at")
);
--> statement-breakpoint
CREATE TABLE "work_location_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"home_place_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_place" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"name" text NOT NULL,
	"geofence_latitude" double precision,
	"geofence_longitude" double precision,
	"geofence_radius_meters" double precision,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_place_hub_id_uq" UNIQUE("hub_id","id"),
	CONSTRAINT "work_place_name_nonempty" CHECK (length(trim("work_place"."name")) > 0),
	CONSTRAINT "work_place_sort_nonnegative" CHECK ("work_place"."sort" >= 0),
	CONSTRAINT "work_place_geofence_shape_check" CHECK ((
        "work_place"."geofence_latitude" IS NULL AND "work_place"."geofence_longitude" IS NULL AND "work_place"."geofence_radius_meters" IS NULL
      ) OR (
        "work_place"."geofence_latitude" BETWEEN -90 AND 90 AND
        "work_place"."geofence_longitude" BETWEEN -180 AND 180 AND
        "work_place"."geofence_radius_meters" BETWEEN 50 AND 2000
      ))
);
--> statement-breakpoint
CREATE TABLE "work_location_external_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"assertion_id" text NOT NULL,
	"exception_date" date,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"parent_external_event_id" text,
	"occurrence_key" text,
	"external_etag" text,
	"remote_updated_at" timestamp,
	"last_projected_revision" integer,
	"payload_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_location_external_binding_revision_positive" CHECK ("work_location_external_binding"."last_projected_revision" IS NULL OR "work_location_external_binding"."last_projected_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "work_location_sync_account" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"capabilities" jsonb NOT NULL,
	"sync_token" text,
	"watch_channel_id" text,
	"watch_resource_id" text,
	"watch_token" text,
	"watch_expires_at" timestamp,
	"bootstrap_completed_at" timestamp,
	"last_succeeded_at" timestamp,
	"last_error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_location_sync_account_state_check" CHECK ("work_location_sync_account"."state" IN ('pending', 'healthy', 'retrying', 'unsupported', 'action_required'))
);
--> statement-breakpoint
CREATE TABLE "work_location_write" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"assertion_id" text NOT NULL,
	"exception_date" date,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"canonical_revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp,
	"last_error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_location_write_operation_check" CHECK ("work_location_write"."operation" IN ('create', 'update', 'delete')),
	CONSTRAINT "work_location_write_status_check" CHECK ("work_location_write"."status" IN ('pending', 'processing', 'applied', 'failed')),
	CONSTRAINT "work_location_write_revision_positive" CHECK ("work_location_write"."canonical_revision" > 0),
	CONSTRAINT "work_location_write_attempts_nonnegative" CHECK ("work_location_write"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_place_provider_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"place_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"classification" text NOT NULL,
	"provider_place_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_place_provider_mapping_classification_nonempty" CHECK (length("work_place_provider_mapping"."classification") > 0)
);
--> statement-breakpoint
ALTER TABLE "calendar_item" ADD COLUMN "work_place_id" text;--> statement-breakpoint
ALTER TABLE "work_location_assertion" ADD CONSTRAINT "work_location_assertion_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_assertion" ADD CONSTRAINT "work_location_assertion_place_fk" FOREIGN KEY ("hub_id","place_id") REFERENCES "public"."work_place"("hub_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_exception" ADD CONSTRAINT "work_location_exception_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_exception" ADD CONSTRAINT "work_location_exception_assertion_id_work_location_assertion_id_fk" FOREIGN KEY ("assertion_id") REFERENCES "public"."work_location_assertion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_exception" ADD CONSTRAINT "work_location_exception_replacement_place_fk" FOREIGN KEY ("hub_id","replacement_place_id") REFERENCES "public"."work_place"("hub_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_observation" ADD CONSTRAINT "work_location_observation_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_observation" ADD CONSTRAINT "work_location_observation_place_fk" FOREIGN KEY ("hub_id","place_id") REFERENCES "public"."work_place"("hub_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_profile" ADD CONSTRAINT "work_location_profile_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_profile" ADD CONSTRAINT "work_location_profile_home_place_fk" FOREIGN KEY ("hub_id","home_place_id") REFERENCES "public"."work_place"("hub_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_place" ADD CONSTRAINT "work_place_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_external_binding" ADD CONSTRAINT "work_location_external_binding_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_external_binding" ADD CONSTRAINT "work_location_external_binding_assertion_id_work_location_assertion_id_fk" FOREIGN KEY ("assertion_id") REFERENCES "public"."work_location_assertion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_external_binding" ADD CONSTRAINT "work_location_external_binding_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_sync_account" ADD CONSTRAINT "work_location_sync_account_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_sync_account" ADD CONSTRAINT "work_location_sync_account_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_write" ADD CONSTRAINT "work_location_write_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_write" ADD CONSTRAINT "work_location_write_assertion_id_work_location_assertion_id_fk" FOREIGN KEY ("assertion_id") REFERENCES "public"."work_location_assertion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location_write" ADD CONSTRAINT "work_location_write_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_place_provider_mapping" ADD CONSTRAINT "work_place_provider_mapping_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_place_provider_mapping" ADD CONSTRAINT "work_place_provider_mapping_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_place_provider_mapping" ADD CONSTRAINT "work_place_provider_mapping_place_fk" FOREIGN KEY ("hub_id","place_id") REFERENCES "public"."work_place"("hub_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_location_assertion_hub_idx" ON "work_location_assertion" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "work_location_assertion_hub_updated_idx" ON "work_location_assertion" USING btree ("hub_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_location_assertion_hub_id_uq" ON "work_location_assertion" USING btree ("hub_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_location_exception_assertion_date_uq" ON "work_location_exception" USING btree ("assertion_id","date");--> statement-breakpoint
CREATE INDEX "work_location_exception_hub_date_idx" ON "work_location_exception" USING btree ("hub_id","date");--> statement-breakpoint
CREATE INDEX "work_location_observation_hub_fresh_idx" ON "work_location_observation" USING btree ("hub_id","expires_at","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_location_profile_hub_uq" ON "work_location_profile" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "work_place_hub_sort_idx" ON "work_place" USING btree ("hub_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "work_location_external_binding_connection_event_uq" ON "work_location_external_binding" USING btree ("connection_id","external_event_id");--> statement-breakpoint
CREATE INDEX "work_location_external_binding_assertion_idx" ON "work_location_external_binding" USING btree ("assertion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_location_sync_account_connection_uq" ON "work_location_sync_account" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "work_location_sync_account_hub_state_idx" ON "work_location_sync_account" USING btree ("hub_id","state");--> statement-breakpoint
CREATE INDEX "work_location_write_due_idx" ON "work_location_write" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "work_location_write_account_idx" ON "work_location_write" USING btree ("connection_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "work_place_provider_mapping_place_connection_uq" ON "work_place_provider_mapping" USING btree ("place_id","connection_id");--> statement-breakpoint
CREATE INDEX "work_place_provider_mapping_connection_idx" ON "work_place_provider_mapping" USING btree ("connection_id");--> statement-breakpoint
ALTER TABLE "calendar_item" ADD CONSTRAINT "calendar_item_work_place_id_work_place_id_fk" FOREIGN KEY ("work_place_id") REFERENCES "public"."work_place"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_item_work_place_idx" ON "calendar_item" USING btree ("work_place_id");