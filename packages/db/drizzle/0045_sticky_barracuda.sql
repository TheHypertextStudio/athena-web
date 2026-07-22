ALTER TYPE "public"."integration_pattern" ADD VALUE 'agent';--> statement-breakpoint
CREATE TABLE "agent_session_external_link" (
	"session_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_session_id" text NOT NULL,
	"external_workspace_id" text NOT NULL,
	"external_issue_id" text,
	"last_relayed_activity_id" text,
	"last_relayed_activity_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_activity" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session_external_link" ADD CONSTRAINT "agent_session_external_link_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_external_link" ADD CONSTRAINT "agent_session_external_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;