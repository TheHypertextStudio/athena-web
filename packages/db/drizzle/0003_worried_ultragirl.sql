ALTER TABLE "organization" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "cycle_cadence_weeks" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "estimate_minutes" integer;