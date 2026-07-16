CREATE TYPE "public"."agent_session_executor_kind" AS ENUM('athena', 'registered_agent');--> statement-breakpoint
ALTER TABLE "agent_session" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session_run" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session_transcript" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session_activity" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "context_organization_id" text;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "executor_kind" "agent_session_executor_kind" DEFAULT 'registered_agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_session_transcript" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_context_organization_id_organization_id_fk" FOREIGN KEY ("context_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD CONSTRAINT "agent_session_run_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_transcript" ADD CONSTRAINT "agent_session_transcript_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_session_owner_idx" ON "agent_session" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_session_context_org_idx" ON "agent_session" USING btree ("context_organization_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_session_run_owner_status_idx" ON "agent_session_run" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "agent_session_transcript_owner_idx" ON "agent_session_transcript" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_id_owner_uq" ON "agent_session" USING btree ("id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_id_org_uq" ON "agent_session" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD CONSTRAINT "agent_session_run_parent_owner_fk" FOREIGN KEY ("session_id","owner_user_id") REFERENCES "public"."agent_session"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD CONSTRAINT "agent_session_run_parent_org_fk" FOREIGN KEY ("session_id","organization_id") REFERENCES "public"."agent_session"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_transcript" ADD CONSTRAINT "agent_session_transcript_parent_owner_fk" FOREIGN KEY ("session_id","owner_user_id") REFERENCES "public"."agent_session"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_transcript" ADD CONSTRAINT "agent_session_transcript_parent_org_fk" FOREIGN KEY ("session_id","organization_id") REFERENCES "public"."agent_session"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_executor_shape_check" CHECK ((
        "agent_session"."executor_kind" = 'athena'
        AND "agent_session"."owner_user_id" IS NOT NULL
        AND "agent_session"."organization_id" IS NULL
        AND "agent_session"."agent_id" IS NULL
      ) OR (
        "agent_session"."executor_kind" = 'registered_agent'
        AND "agent_session"."owner_user_id" IS NULL
        AND "agent_session"."context_organization_id" IS NULL
        AND "agent_session"."organization_id" IS NOT NULL
        AND "agent_session"."agent_id" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "agent_session_run" ADD CONSTRAINT "agent_session_run_attribution_check" CHECK (("agent_session_run"."owner_user_id" IS NOT NULL AND "agent_session_run"."organization_id" IS NULL)
        OR ("agent_session_run"."owner_user_id" IS NULL AND "agent_session_run"."organization_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "agent_session_transcript" ADD CONSTRAINT "agent_session_transcript_attribution_check" CHECK (("agent_session_transcript"."owner_user_id" IS NOT NULL AND "agent_session_transcript"."organization_id" IS NULL)
        OR ("agent_session_transcript"."owner_user_id" IS NULL AND "agent_session_transcript"."organization_id" IS NOT NULL));
