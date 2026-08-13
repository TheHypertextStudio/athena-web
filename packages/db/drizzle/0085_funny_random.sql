CREATE TYPE "public"."activity_day_status" AS ENUM('pending', 'reconciling', 'ready', 'empty', 'failed');--> statement-breakpoint
CREATE TYPE "public"."activity_narration_state" AS ENUM('pending', 'generating', 'ready', 'failed');--> statement-breakpoint
-- `IF NOT EXISTS` is required, not cosmetic: both values are pre-committed by `ENUM_PREFLIGHT` in
-- `src/migrate.ts` before Drizzle opens its all-migrations transaction, so a bare `ADD VALUE` would
-- fail on a duplicate label on every database the preflight has already run against.
ALTER TYPE "public"."event_kind" ADD VALUE IF NOT EXISTS 'meeting_attended';--> statement-breakpoint
ALTER TYPE "public"."sync_run_purpose" ADD VALUE IF NOT EXISTS 'activity_pull';--> statement-breakpoint
CREATE TABLE "activity_day" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" date NOT NULL,
	"timezone" text NOT NULL,
	"status" "activity_day_status" DEFAULT 'pending' NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"stats" jsonb,
	"reconciled_at" timestamp,
	"narrated_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_highlight" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_day_id" text NOT NULL,
	"episode_key" text NOT NULL,
	"sort" integer NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"ended_at" timestamp NOT NULL,
	"source_system" "source_system" NOT NULL,
	"entity_kind" "canonical_entity_kind",
	"docket_entity_id" text,
	"entity_association" "entity_association" DEFAULT 'unmatched' NOT NULL,
	"subject_title" text,
	"event_ids" text[] NOT NULL,
	"narration_state" "activity_narration_state" DEFAULT 'pending' NOT NULL,
	"narration" text,
	"edited_narration" text,
	"kept" boolean DEFAULT true NOT NULL,
	"curated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_digest" ADD COLUMN "activity_day_id" text;--> statement-breakpoint
ALTER TABLE "activity_highlight" ADD CONSTRAINT "activity_highlight_activity_day_id_activity_day_id_fk" FOREIGN KEY ("activity_day_id") REFERENCES "public"."activity_day"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_day_user_date_uq" ON "activity_day" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "activity_day_status_idx" ON "activity_day" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_highlight_day_episode_uq" ON "activity_highlight" USING btree ("activity_day_id","episode_key");--> statement-breakpoint
CREATE INDEX "activity_highlight_day_sort_idx" ON "activity_highlight" USING btree ("activity_day_id","sort");--> statement-breakpoint
ALTER TABLE "daily_digest" ADD CONSTRAINT "daily_digest_activity_day_id_activity_day_id_fk" FOREIGN KEY ("activity_day_id") REFERENCES "public"."activity_day"("id") ON DELETE set null ON UPDATE no action;