ALTER TYPE "public"."attachment_kind" ADD VALUE 'athena_email';--> statement-breakpoint
CREATE TABLE "lattice_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" "integration_status" DEFAULT 'pending' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"device_id" text,
	"device_name" text,
	"device_status" text,
	"granted_scope" text,
	"account_id" text,
	"last_failure_reason" text,
	"last_failure_at" timestamp,
	"last_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lattice_connection_id_owner_uq" UNIQUE("id","owner_user_id"),
	CONSTRAINT "lattice_connection_enabled_needs_device_check" CHECK ("lattice_connection"."enabled" = false OR "lattice_connection"."device_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "lattice_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athena_inbound_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"owner_user_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"rfc822_message_id" text,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_address" text NOT NULL,
	"title" text NOT NULL,
	"body_text" text,
	"body_html" text,
	"snippet" text,
	"body_status" text DEFAULT 'complete' NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stream_event_id" text,
	"session_id" text,
	CONSTRAINT "athena_inbound_message_body_status_check" CHECK ("athena_inbound_message"."body_status" in ('complete', 'metadata-only')),
	CONSTRAINT "athena_inbound_message_provider_check" CHECK ("athena_inbound_message"."provider" in ('resend', 'fixture'))
);
--> statement-breakpoint
CREATE TABLE "athena_mailbox" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"key" text NOT NULL,
	"organization_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lattice_connection" ADD CONSTRAINT "lattice_connection_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lattice_credential" ADD CONSTRAINT "lattice_credential_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lattice_credential" ADD CONSTRAINT "lattice_credential_connection_owner_fk" FOREIGN KEY ("connection_id","owner_user_id") REFERENCES "public"."lattice_connection"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_inbound_message" ADD CONSTRAINT "athena_inbound_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_inbound_message" ADD CONSTRAINT "athena_inbound_message_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_inbound_message" ADD CONSTRAINT "athena_inbound_message_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_inbound_message" ADD CONSTRAINT "athena_inbound_message_mailbox_id_athena_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."athena_mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_inbound_message" ADD CONSTRAINT "athena_inbound_message_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_mailbox" ADD CONSTRAINT "athena_mailbox_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_mailbox" ADD CONSTRAINT "athena_mailbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lattice_connection_owner_uq" ON "lattice_connection" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lattice_credential_connection_uq" ON "lattice_credential" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "athena_inbound_message_owner_provider_uq" ON "athena_inbound_message" USING btree ("owner_user_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "athena_inbound_message_owner_received_idx" ON "athena_inbound_message" USING btree ("owner_user_id","received_at");--> statement-breakpoint
CREATE INDEX "athena_inbound_message_org_idx" ON "athena_inbound_message" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "athena_mailbox_key_uq" ON "athena_mailbox" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "athena_mailbox_owner_uq" ON "athena_mailbox" USING btree ("owner_user_id");