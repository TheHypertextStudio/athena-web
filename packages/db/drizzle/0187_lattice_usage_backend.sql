ALTER TABLE "agent_session_run"
ADD COLUMN "usage_backend" text;

--> statement-breakpoint
ALTER TABLE "agent_delegation"
ADD COLUMN "result_received_at" timestamp with time zone;
