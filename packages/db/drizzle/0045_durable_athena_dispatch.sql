CREATE TABLE "agent_session_dispatch" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp,
	"last_error" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_session_dispatch_action_check" CHECK ("agent_session_dispatch"."action" in ('enqueue', 'wake')),
	CONSTRAINT "agent_session_dispatch_status_check" CHECK ("agent_session_dispatch"."status" in ('pending', 'delivering', 'delivered', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "agent_session_dispatch" ADD CONSTRAINT "agent_session_dispatch_run_id_agent_session_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_session_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_dispatch_run_action_uq" ON "agent_session_dispatch" USING btree ("run_id","action");--> statement-breakpoint
CREATE INDEX "agent_session_dispatch_due_idx" ON "agent_session_dispatch" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "agent_session_dispatch_lease_idx" ON "agent_session_dispatch" USING btree ("status","lease_expires_at");