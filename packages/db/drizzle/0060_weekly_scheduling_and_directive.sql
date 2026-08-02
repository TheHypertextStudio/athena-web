CREATE TABLE "day_check_in" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"date" text NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"fired_at" timestamp,
	"responded_at" timestamp,
	"response" text,
	"note" text,
	"block_calendar_item_id" text,
	"block_title" text,
	"outstanding_goals" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_directive" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"date" text NOT NULL,
	"timezone" text NOT NULL,
	"posture" text DEFAULT 'on_track' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"directive_id" text NOT NULL,
	"recommended_calendar_item_id" text,
	"recommended_task_id" text,
	"agenda_acknowledged_at" timestamp,
	"review_completed_at" timestamp,
	"last_reorganized_at" timestamp,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_review" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"date" text NOT NULL,
	"timezone" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tomorrow_proposals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tomorrow_confirmed_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directive_acknowledgment" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"directive_id" text NOT NULL,
	"client_id" text,
	"applied_posture" text NOT NULL,
	"enforced" boolean NOT NULL,
	"note" text,
	"acknowledged_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_run" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"week_start_date" text NOT NULL,
	"timezone" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"user_input_count" integer DEFAULT 1 NOT NULL,
	"block_count" integer DEFAULT 0 NOT NULL,
	"available_minutes" integer DEFAULT 0 NOT NULL,
	"scheduled_minutes" integer DEFAULT 0 NOT NULL,
	"protected_minutes" integer DEFAULT 0 NOT NULL,
	"largest_gap_minutes" integer DEFAULT 0 NOT NULL,
	"unplaced" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"timezone" text,
	"windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commitments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reflection_for_meetings" boolean DEFAULT true NOT NULL,
	"backfill_shapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_unplanned_gap_minutes" integer DEFAULT 60 NOT NULL,
	"min_transit_gap_minutes" integer DEFAULT 15 NOT NULL,
	"max_transit_gap_minutes" integer DEFAULT 120 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_item" ADD COLUMN "work_shape" text;--> statement-breakpoint
ALTER TABLE "calendar_item" ADD COLUMN "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_item" ADD COLUMN "schedule_run_id" text;--> statement-breakpoint
ALTER TABLE "day_check_in" ADD CONSTRAINT "day_check_in_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_directive" ADD CONSTRAINT "day_directive_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_review" ADD CONSTRAINT "day_review_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directive_acknowledgment" ADD CONSTRAINT "directive_acknowledgment_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directive_acknowledgment" ADD CONSTRAINT "directive_acknowledgment_acknowledged_by_user_id_user_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_run" ADD CONSTRAINT "schedule_run_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_preference" ADD CONSTRAINT "scheduling_preference_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "day_check_in_hub_date_idx" ON "day_check_in" USING btree ("hub_id","date");--> statement-breakpoint
CREATE INDEX "day_check_in_scheduled_idx" ON "day_check_in" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "day_check_in_hub_scheduled_uq" ON "day_check_in" USING btree ("hub_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "day_directive_hub_date_uq" ON "day_directive" USING btree ("hub_id","date");--> statement-breakpoint
CREATE INDEX "day_directive_hub_computed_idx" ON "day_directive" USING btree ("hub_id","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "day_review_hub_date_uq" ON "day_review" USING btree ("hub_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "directive_ack_hub_directive_uq" ON "directive_acknowledgment" USING btree ("hub_id","directive_id");--> statement-breakpoint
CREATE INDEX "schedule_run_hub_week_idx" ON "schedule_run" USING btree ("hub_id","week_start_date");--> statement-breakpoint
CREATE INDEX "schedule_run_hub_generated_idx" ON "schedule_run" USING btree ("hub_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduling_preference_hub_uq" ON "scheduling_preference" USING btree ("hub_id");--> statement-breakpoint
CREATE INDEX "calendar_item_schedule_run_idx" ON "calendar_item" USING btree ("schedule_run_id");