CREATE TABLE "work_schedule_exception" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"plan_version_id" text NOT NULL,
	"date" date NOT NULL,
	"segments" jsonb NOT NULL,
	"origin" text DEFAULT 'docket' NOT NULL,
	"origin_provider" text,
	"origin_connection_id" text,
	"source_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedule_exception_origin_check" CHECK ("work_schedule_exception"."origin" IN ('docket', 'provider'))
);
--> statement-breakpoint
CREATE TABLE "work_schedule_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"anchor_date" date NOT NULL,
	"timezone" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"cycle_days" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedule_plan_hub_id_uq" UNIQUE("hub_id","id"),
	CONSTRAINT "work_schedule_plan_dates_check" CHECK ("work_schedule_plan"."effective_until" IS NULL OR "work_schedule_plan"."effective_until" >= "work_schedule_plan"."effective_from"),
	CONSTRAINT "work_schedule_plan_timezone_nonempty" CHECK (length(trim("work_schedule_plan"."timezone")) > 0),
	CONSTRAINT "work_schedule_plan_revision_positive" CHECK ("work_schedule_plan"."revision" > 0),
	CONSTRAINT "work_schedule_plan_cycle_length_check" CHECK (jsonb_array_length("work_schedule_plan"."cycle_days") BETWEEN 1 AND 28)
);
--> statement-breakpoint
CREATE FUNCTION "enforce_work_schedule_plan_non_overlap"() RETURNS trigger AS $$
BEGIN
	LOCK TABLE "work_schedule_plan" IN SHARE ROW EXCLUSIVE MODE;
	IF EXISTS (
		SELECT 1
		FROM "work_schedule_plan" existing
		WHERE existing."hub_id" = NEW."hub_id"
			AND existing."id" <> NEW."id"
			AND daterange(
				existing."effective_from",
				COALESCE(existing."effective_until", 'infinity'::date),
				'[]'
			) && daterange(
				NEW."effective_from",
				COALESCE(NEW."effective_until", 'infinity'::date),
				'[]'
			)
	) THEN
		RAISE EXCEPTION 'work schedule plan dates overlap for hub %', NEW."hub_id"
			USING ERRCODE = '23P01',
				CONSTRAINT = 'work_schedule_plan_hub_effective_range_excl';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "work_schedule_plan_non_overlap_trigger"
	BEFORE INSERT OR UPDATE OF "hub_id", "effective_from", "effective_until"
	ON "work_schedule_plan"
	FOR EACH ROW EXECUTE FUNCTION "enforce_work_schedule_plan_non_overlap"();--> statement-breakpoint
CREATE TABLE "work_place_alias" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"normalized_label" text NOT NULL,
	"display_label" text NOT NULL,
	"place_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_place_alias_label_nonempty" CHECK (length(trim("work_place_alias"."normalized_label")) > 0),
	CONSTRAINT "work_place_alias_display_nonempty" CHECK (length(trim("work_place_alias"."display_label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "work_schedule_change" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"connection_id" text,
	"provider" text,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"provider_updated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedule_change_kind_check" CHECK ("work_schedule_change"."kind" IN ('unmatched_place', 'schedule_conflict', 'legacy_conflict')),
	CONSTRAINT "work_schedule_change_state_check" CHECK ("work_schedule_change"."state" IN ('pending', 'resolved', 'ignored')),
	CONSTRAINT "work_schedule_change_key_nonempty" CHECK (length(trim("work_schedule_change"."dedupe_key")) > 0),
	CONSTRAINT "work_schedule_change_provider_shape_check" CHECK (("work_schedule_change"."connection_id" IS NULL AND "work_schedule_change"."provider" IS NULL) OR ("work_schedule_change"."connection_id" IS NOT NULL AND "work_schedule_change"."provider" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "work_location_assertion" ADD COLUMN "source_plan_version_id" text;--> statement-breakpoint
ALTER TABLE "work_location_assertion" ADD COLUMN "source_plan_key" text;--> statement-breakpoint
ALTER TABLE "work_schedule_exception" ADD CONSTRAINT "work_schedule_exception_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_exception" ADD CONSTRAINT "work_schedule_exception_plan_fk" FOREIGN KEY ("hub_id","plan_version_id") REFERENCES "public"."work_schedule_plan"("hub_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_plan" ADD CONSTRAINT "work_schedule_plan_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_place_alias" ADD CONSTRAINT "work_place_alias_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_place_alias" ADD CONSTRAINT "work_place_alias_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_place_alias" ADD CONSTRAINT "work_place_alias_place_fk" FOREIGN KEY ("hub_id","place_id") REFERENCES "public"."work_place"("hub_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_change" ADD CONSTRAINT "work_schedule_change_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_change" ADD CONSTRAINT "work_schedule_change_connection_id_calendar_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedule_exception_plan_date_uq" ON "work_schedule_exception" USING btree ("plan_version_id","date");--> statement-breakpoint
CREATE INDEX "work_schedule_exception_hub_date_idx" ON "work_schedule_exception" USING btree ("hub_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedule_plan_hub_start_uq" ON "work_schedule_plan" USING btree ("hub_id","effective_from");--> statement-breakpoint
CREATE INDEX "work_schedule_plan_hub_dates_idx" ON "work_schedule_plan" USING btree ("hub_id","effective_from","effective_until");--> statement-breakpoint
CREATE UNIQUE INDEX "work_place_alias_connection_label_uq" ON "work_place_alias" USING btree ("connection_id","normalized_label");--> statement-breakpoint
CREATE INDEX "work_place_alias_place_idx" ON "work_place_alias" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedule_change_connection_key_uq" ON "work_schedule_change" USING btree ("connection_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "work_schedule_change_hub_state_idx" ON "work_schedule_change" USING btree ("hub_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_location_assertion_hub_plan_key_uq" ON "work_location_assertion" USING btree ("hub_id","source_plan_key");
