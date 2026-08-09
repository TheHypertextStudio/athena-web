ALTER TABLE "day_directive" ADD COLUMN "morning_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling_preference" ADD COLUMN "check_in_cadence_minutes" integer DEFAULT 150 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling_preference" ADD COLUMN "auto_reorganize_on_drift" boolean DEFAULT true NOT NULL;