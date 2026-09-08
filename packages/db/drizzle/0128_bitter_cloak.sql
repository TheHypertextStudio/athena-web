CREATE TABLE "calendar_source_group" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"preferred_layer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_source_group_member" (
	"group_id" text NOT NULL,
	"layer_id" text NOT NULL,
	CONSTRAINT "calendar_source_group_member_group_id_layer_id_pk" PRIMARY KEY("group_id","layer_id"),
	CONSTRAINT "calendar_source_group_member_layer_uq" UNIQUE("layer_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_item" ADD COLUMN "event_identity_namespace" text;--> statement-breakpoint
ALTER TABLE "calendar_item" ADD COLUMN "event_identity_value" text;--> statement-breakpoint
ALTER TABLE "calendar_item" ADD COLUMN "occurrence_identity" text;--> statement-breakpoint
ALTER TABLE "calendar_layer" ADD COLUMN "source_identity_namespace" text;--> statement-breakpoint
ALTER TABLE "calendar_layer" ADD COLUMN "source_identity_value" text;--> statement-breakpoint
ALTER TABLE "calendar_layer" ADD COLUMN "source_relationship" text;--> statement-breakpoint
ALTER TABLE "calendar_layer" ADD COLUMN "source_management" jsonb;--> statement-breakpoint
ALTER TABLE "calendar_layer" ADD COLUMN "suggested_group_key" text;--> statement-breakpoint
ALTER TABLE "calendar_layer" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_list" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_source_group" ADD CONSTRAINT "calendar_source_group_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_source_group" ADD CONSTRAINT "calendar_source_group_preferred_layer_id_calendar_layer_id_fk" FOREIGN KEY ("preferred_layer_id") REFERENCES "public"."calendar_layer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_source_group_member" ADD CONSTRAINT "calendar_source_group_member_group_id_calendar_source_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."calendar_source_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_source_group_member" ADD CONSTRAINT "calendar_source_group_member_layer_id_calendar_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."calendar_layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_source_group_user_idx" ON "calendar_source_group" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendar_item_user_event_identity_idx" ON "calendar_item" USING btree ("user_id","event_identity_namespace","event_identity_value","occurrence_identity");--> statement-breakpoint
CREATE INDEX "calendar_layer_user_source_identity_idx" ON "calendar_layer" USING btree ("user_id","source_identity_namespace","source_identity_value");--> statement-breakpoint

-- Existing provider layers already carry the adapter-normalized external calendar id. Titles are
-- presentation data and never participate in identity or grouping.
UPDATE "calendar_layer"
SET
	"source_identity_namespace" = "provider" || '-calendar',
	"source_identity_value" = "external_layer_id",
	"source_relationship" = CASE
		WHEN "primary" OR "access_role" = 'owner' THEN 'owned'
		ELSE 'subscribed'
	END,
	"source_management" = jsonb_build_object(
		'canRemoveSubscription', NOT "primary" AND COALESCE("access_role", '') <> 'owner',
		'requiresIncrementalConsent', "provider" = 'google'
	)
WHERE "source_kind" = 'provider_calendar'
	AND "provider" IS NOT NULL
	AND "external_layer_id" IS NOT NULL;--> statement-breakpoint

-- Google iCalUID identifies the event across calendars. A recurring event is only safe to group
-- when originalStartTime also identifies the occurrence. Other rows remain source-local.
UPDATE "calendar_item"
SET
	"event_identity_namespace" = CASE
		WHEN "provider" = 'google'
			AND NULLIF("provider_raw" ->> 'iCalUID', '') IS NOT NULL
			AND (
				"recurring_event_id" IS NULL
				OR COALESCE(
					"provider_raw" -> 'originalStartTime' ->> 'dateTime',
					"provider_raw" -> 'originalStartTime' ->> 'date'
				) IS NOT NULL
			)
		THEN 'ical'
		ELSE "provider" || '-event:' || COALESCE("external_calendar_id", '')
	END,
	"event_identity_value" = CASE
		WHEN "provider" = 'google'
			AND NULLIF("provider_raw" ->> 'iCalUID', '') IS NOT NULL
			AND (
				"recurring_event_id" IS NULL
				OR COALESCE(
					"provider_raw" -> 'originalStartTime' ->> 'dateTime',
					"provider_raw" -> 'originalStartTime' ->> 'date'
				) IS NOT NULL
			)
		THEN "provider_raw" ->> 'iCalUID'
		ELSE "external_event_id"
	END,
	"occurrence_identity" = CASE
		WHEN "recurring_event_id" IS NOT NULL THEN COALESCE(
			"provider_raw" -> 'originalStartTime' ->> 'dateTime',
			"provider_raw" -> 'originalStartTime' ->> 'date'
		)
		ELSE NULL
	END
WHERE "kind" = 'provider_event'
	AND "provider" IS NOT NULL
	AND "external_event_id" IS NOT NULL;
