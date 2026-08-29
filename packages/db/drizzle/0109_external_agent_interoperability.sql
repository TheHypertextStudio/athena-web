ALTER TABLE "agent_session_external_link" RENAME COLUMN "external_issue_id" TO "external_work_item_id";--> statement-breakpoint
ALTER TABLE "agent_session_external_link" ADD COLUMN "relay_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session_external_link" ADD COLUMN "relay_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session_external_link" ADD COLUMN "next_relay_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_session_external_link" ADD COLUMN "last_relay_error" text;--> statement-breakpoint
ALTER TABLE "agent_session_external_link" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_external_link_provider_session_uq" ON "agent_session_external_link" USING btree ("provider","external_workspace_id","external_session_id");--> statement-breakpoint
CREATE INDEX "agent_session_external_link_relay_due_idx" ON "agent_session_external_link" USING btree ("relay_status","next_relay_at");--> statement-breakpoint
ALTER TABLE "agent_session_external_link" ADD CONSTRAINT "agent_session_external_link_relay_status_check" CHECK ("agent_session_external_link"."relay_status" in ('pending', 'ready', 'retrying', 'errored'));--> statement-breakpoint
ALTER TABLE "agent_session_external_link" ADD CONSTRAINT "agent_session_external_link_relay_attempts_check" CHECK ("agent_session_external_link"."relay_attempts" >= 0);