CREATE TABLE "athena_mail_blob" (
	"key" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athena_mail_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"inbound_message_id" text,
	"session_id" text,
	"channel_revision" integer NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_stage" text DEFAULT 'settled' NOT NULL,
	"external_recipient" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athena_mail_provider_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_message_id" text NOT NULL,
	"kind" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session" DROP CONSTRAINT "agent_session_work_linkage_check";--> statement-breakpoint
ALTER TABLE "athena_inbound_message" ADD COLUMN "processing_status" text DEFAULT 'captured' NOT NULL;--> statement-breakpoint
ALTER TABLE "athena_inbound_message" ADD COLUMN "channel_revision" integer;--> statement-breakpoint
ALTER TABLE "athena_inbound_message" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "athena_inbound_message" ADD COLUMN "headers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "athena_inbound_message" ADD COLUMN "authentication" jsonb;--> statement-breakpoint
ALTER TABLE "athena_mailbox" ADD COLUMN "enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "athena_mailbox" ADD COLUMN "owner_replies_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "athena_mailbox" ADD COLUMN "owner_address" text;--> statement-breakpoint
ALTER TABLE "athena_mailbox" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "athena_mail_outbox" ADD CONSTRAINT "athena_mail_outbox_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_mail_outbox" ADD CONSTRAINT "athena_mail_outbox_mailbox_id_athena_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."athena_mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_mail_outbox" ADD CONSTRAINT "athena_mail_outbox_inbound_message_id_athena_inbound_message_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."athena_inbound_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_mail_outbox" ADD CONSTRAINT "athena_mail_outbox_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "athena_mail_outbox_inbound_uq" ON "athena_mail_outbox" USING btree ("inbound_message_id","response_stage");--> statement-breakpoint
CREATE INDEX "athena_mail_outbox_status_idx" ON "athena_mail_outbox" USING btree ("status","available_at");--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_work_linkage_check" CHECK (("agent_session"."work_linkage" = 'task' AND "agent_session"."task_id" IS NOT NULL)
        OR ("agent_session"."work_linkage" = 'conversation' AND "agent_session"."kind" = 'chat') OR ("agent_session"."work_linkage" = 'observation' AND "agent_session"."kind" = 'job' AND ("agent_session"."external_run_ref" LIKE 'notification-triage:%' OR "agent_session"."external_run_ref" LIKE 'athena-mail:%'))
        OR "agent_session"."work_linkage" = 'unclassified');