CREATE TYPE "public"."session_kind" AS ENUM('chat', 'job');--> statement-breakpoint
CREATE TABLE "integration_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_session_transcript" (
	"session_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "kind" "session_kind" DEFAULT 'job' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_activity" ADD COLUMN "proposal_group_id" text;--> statement-breakpoint
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_transcript" ADD CONSTRAINT "agent_session_transcript_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_transcript" ADD CONSTRAINT "agent_session_transcript_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credential_integration_uq" ON "integration_credential" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "session_activity_proposal_group_idx" ON "session_activity" USING btree ("session_id","proposal_group_id");