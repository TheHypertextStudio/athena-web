ALTER TABLE "team" RENAME COLUMN "cycle_cadence_weeks" TO "cycle_cadence_days";--> statement-breakpoint
UPDATE "team" SET "cycle_cadence_days" = "cycle_cadence_days" * 7;--> statement-breakpoint
ALTER TABLE "team" ALTER COLUMN "cycle_cadence_days" SET DEFAULT 7;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "cycle_cadence_anchor" date DEFAULT '2024-01-01' NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "cycle_cadence_revision" integer DEFAULT 1 NOT NULL;
