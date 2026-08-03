CREATE TABLE "mcp_task" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" serial NOT NULL,
	"owner_key" text NOT NULL,
	"session_id" text,
	"status" text NOT NULL,
	"status_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"ttl_ms" integer,
	"poll_interval_ms" integer,
	"result" jsonb,
	"error" jsonb,
	"input_requests" jsonb,
	"resolved_input_keys" jsonb,
	"cancellation_requested" boolean DEFAULT false NOT NULL,
	"cancellation_requested_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "mcp_task_owner_idx" ON "mcp_task" USING btree ("owner_key");--> statement-breakpoint
CREATE INDEX "mcp_task_last_updated_idx" ON "mcp_task" USING btree ("last_updated_at");