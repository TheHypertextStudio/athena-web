ALTER TABLE "audit_event" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_session" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "mcp_session" ADD COLUMN "client_version" text;