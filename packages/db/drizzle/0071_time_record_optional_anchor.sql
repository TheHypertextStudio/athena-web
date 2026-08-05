ALTER TABLE "time_interval" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time_record" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time_record" ADD CONSTRAINT "time_record_closed_requires_anchor" CHECK ("time_record"."status" IN ('open','paused') OR "time_record"."task_id" IS NOT NULL);