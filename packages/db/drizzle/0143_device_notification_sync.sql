CREATE TABLE "device_notification" (
	"hub_id" text NOT NULL,
	"id" text NOT NULL,
	"source_id" text NOT NULL,
	"platform" text NOT NULL,
	"extractor_version" integer NOT NULL,
	"app_id" text NOT NULL,
	"app_name" text NOT NULL,
	"source_key" text NOT NULL,
	"thread_id" text,
	"thread_title" text,
	"kind" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"title" text,
	"subtitle" text,
	"body" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"redacted" boolean NOT NULL,
	"scrubbed" boolean NOT NULL,
	"backfilled" boolean NOT NULL,
	"content_hash" text NOT NULL,
	"android_channel_id" text,
	"android_category" text,
	"android_when_at" timestamp with time zone,
	"android_shortcut_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "device_notification_pk" PRIMARY KEY("hub_id","id"),
	CONSTRAINT "device_notification_kind_check" CHECK ("device_notification"."kind" IN ('message', 'email', 'call', 'event', 'reminder', 'alarm', 'social', 'promotion', 'status', 'system', 'other')),
	CONSTRAINT "device_notification_platform_check" CHECK ("device_notification"."platform" IN ('android')),
	CONSTRAINT "device_notification_expiry_check" CHECK ("device_notification"."expires_at" > "device_notification"."captured_at")
);
--> statement-breakpoint
CREATE TABLE "device_notification_deletion" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"app_id" text,
	"deleted_before" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_notification_deletion_hub_app_uq" UNIQUE NULLS NOT DISTINCT("hub_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "device_notification_message" (
	"hub_id" text NOT NULL,
	"id" text NOT NULL,
	"notification_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"sender" text,
	"sent_at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"identity" text NOT NULL,
	CONSTRAINT "device_notification_message_pk" PRIMARY KEY("hub_id","id"),
	CONSTRAINT "device_notification_message_hub_identity_uq" UNIQUE("hub_id","identity")
);
--> statement-breakpoint
CREATE TABLE "device_notification_removal" (
	"hub_id" text NOT NULL,
	"id" text NOT NULL,
	"notification_id" text NOT NULL,
	"removed_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"platform_reason" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_notification_removal_pk" PRIMARY KEY("hub_id","id"),
	CONSTRAINT "device_notification_removal_hub_notification_uq" UNIQUE("hub_id","notification_id"),
	CONSTRAINT "device_notification_removal_reason_check" CHECK ("device_notification_removal"."reason" IN ('opened', 'dismissed', 'dismissed_all', 'withdrawn_by_app', 'expired', 'snoozed', 'other', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "device_notification_source" (
	"hub_id" text NOT NULL,
	"id" text NOT NULL,
	"platform" text NOT NULL,
	"label" text NOT NULL,
	"retention_days" integer NOT NULL,
	"sync_consented_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_notification_source_pk" PRIMARY KEY("hub_id","id"),
	CONSTRAINT "device_notification_source_platform_check" CHECK ("device_notification_source"."platform" IN ('android')),
	CONSTRAINT "device_notification_source_retention_check" CHECK ("device_notification_source"."retention_days" BETWEEN 1 AND 3650)
);
--> statement-breakpoint
CREATE TABLE "device_notification_upload_window" (
	"hub_id" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"batches" integer NOT NULL,
	CONSTRAINT "device_notification_upload_window_batches_check" CHECK ("device_notification_upload_window"."batches" >= 0)
);
--> statement-breakpoint
ALTER TABLE "device_notification" ADD CONSTRAINT "device_notification_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_notification" ADD CONSTRAINT "device_notification_source_fk" FOREIGN KEY ("hub_id","source_id") REFERENCES "public"."device_notification_source"("hub_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_notification_deletion" ADD CONSTRAINT "device_notification_deletion_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_notification_message" ADD CONSTRAINT "device_notification_message_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_notification_message" ADD CONSTRAINT "device_notification_message_notification_fk" FOREIGN KEY ("hub_id","notification_id") REFERENCES "public"."device_notification"("hub_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_notification_removal" ADD CONSTRAINT "device_notification_removal_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_notification_removal" ADD CONSTRAINT "device_notification_removal_notification_fk" FOREIGN KEY ("hub_id","notification_id") REFERENCES "public"."device_notification"("hub_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_notification_source" ADD CONSTRAINT "device_notification_source_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_notification_upload_window" ADD CONSTRAINT "device_notification_upload_window_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_notification_hub_captured_idx" ON "device_notification" USING btree ("hub_id","captured_at","id");--> statement-breakpoint
CREATE INDEX "device_notification_hub_app_captured_idx" ON "device_notification" USING btree ("hub_id","app_id","captured_at");--> statement-breakpoint
CREATE INDEX "device_notification_expires_idx" ON "device_notification" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "device_notification_text_gin" ON "device_notification" USING gin ((
        setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce("thread_title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce("subtitle", '')), 'B') ||
        setweight(to_tsvector('simple', coalesce("body", '')), 'C') ||
        setweight(to_tsvector('simple', "lines"), 'C')
      ));--> statement-breakpoint
CREATE INDEX "device_notification_message_notification_idx" ON "device_notification_message" USING btree ("hub_id","notification_id");--> statement-breakpoint
CREATE INDEX "device_notification_message_text_gin" ON "device_notification_message" USING gin (to_tsvector('simple', "text"));