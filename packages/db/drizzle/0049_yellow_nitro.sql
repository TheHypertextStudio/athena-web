CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency');--> statement-breakpoint
CREATE TABLE "mcp_session" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_key" text NOT NULL,
	"protocol_version" text,
	"log_level" "log_level" DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mcp_subscription" (
	"session_id" text NOT NULL,
	"uri" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_subscription" ADD CONSTRAINT "mcp_subscription_session_id_mcp_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."mcp_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_session_principal_idx" ON "mcp_session" USING btree ("principal_key");--> statement-breakpoint
CREATE INDEX "mcp_session_last_seen_idx" ON "mcp_session" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_subscription_session_uri_uq" ON "mcp_subscription" USING btree ("session_id","uri");--> statement-breakpoint
CREATE INDEX "mcp_subscription_uri_idx" ON "mcp_subscription" USING btree ("uri");