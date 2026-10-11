CREATE TABLE "notification_triage_event" (
	"hub_id" text NOT NULL,
	"notification_id" text NOT NULL,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_triage_event_hub_id_notification_id_pk" PRIMARY KEY("hub_id","notification_id")
);
--> statement-breakpoint
CREATE TABLE "notification_triage_settings" (
	"hub_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabled_at" timestamp with time zone,
	"active_session_id" text,
	"lease_token" text,
	"lease_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_session" DROP CONSTRAINT "agent_session_work_linkage_check";--> statement-breakpoint
ALTER TABLE "notification_triage_event" ADD CONSTRAINT "notification_triage_event_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_triage_event" ADD CONSTRAINT "notification_triage_event_hub_id_notification_id_device_notification_hub_id_id_fk" FOREIGN KEY ("hub_id","notification_id") REFERENCES "public"."device_notification"("hub_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_triage_settings" ADD CONSTRAINT "notification_triage_settings_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_triage_settings" ADD CONSTRAINT "notification_triage_settings_active_session_id_agent_session_id_fk" FOREIGN KEY ("active_session_id") REFERENCES "public"."agent_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_triage_event_pending_idx" ON "notification_triage_event" USING btree ("hub_id","session_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_work_linkage_check" CHECK (("agent_session"."work_linkage" = 'task' AND "agent_session"."task_id" IS NOT NULL)
        OR ("agent_session"."work_linkage" = 'conversation' AND "agent_session"."kind" = 'chat')
        OR ("agent_session"."work_linkage" = 'observation' AND "agent_session"."kind" = 'job' AND "agent_session"."external_run_ref" LIKE 'notification-triage:%')
        OR "agent_session"."work_linkage" = 'unclassified');