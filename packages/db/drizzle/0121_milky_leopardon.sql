ALTER TABLE "agent_session_run" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD COLUMN "cache_creation_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD COLUMN "model" text;