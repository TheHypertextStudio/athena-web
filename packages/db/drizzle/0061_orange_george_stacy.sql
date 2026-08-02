CREATE TABLE "agent_elicitation" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"organization_id" text,
	"asked_user_id" text NOT NULL,
	"task_id" text NOT NULL,
	"tool_use_id" text,
	"question" text NOT NULL,
	"action_summary" text NOT NULL,
	"spec" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"timeout_policy" text DEFAULT 'ambiguous' NOT NULL,
	"time_sensitive" boolean DEFAULT false NOT NULL,
	"live" boolean DEFAULT false NOT NULL,
	"auto_resolve_value" jsonb,
	"auto_resolve_reason" text,
	"expires_at" timestamp NOT NULL,
	"answer" jsonb,
	"resolver" text,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_elicitation_status_check" CHECK ("agent_elicitation"."status" in ('pending', 'answered', 'auto_resolved', 'parked', 'canceled')),
	CONSTRAINT "agent_elicitation_timeout_policy_check" CHECK ("agent_elicitation"."timeout_policy" in ('derivable', 'ambiguous', 'destructive')),
	CONSTRAINT "agent_elicitation_resolver_check" CHECK ("agent_elicitation"."resolver" is null or "agent_elicitation"."resolver" in ('user', 'athena', 'timeout')),
	CONSTRAINT "agent_elicitation_resolution_check" CHECK (("agent_elicitation"."status" = 'pending' AND "agent_elicitation"."resolver" IS NULL AND "agent_elicitation"."settled_at" IS NULL)
        OR ("agent_elicitation"."status" <> 'pending' AND "agent_elicitation"."resolver" IS NOT NULL AND "agent_elicitation"."settled_at" IS NOT NULL)),
	CONSTRAINT "agent_elicitation_derivable_check" CHECK ("agent_elicitation"."timeout_policy" <> 'derivable' OR "agent_elicitation"."auto_resolve_value" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "athena_presence" (
	"user_id" text PRIMARY KEY NOT NULL,
	"focused_at" timestamp,
	"seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_elicitation" ADD CONSTRAINT "agent_elicitation_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_elicitation" ADD CONSTRAINT "agent_elicitation_activity_id_session_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."session_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_elicitation" ADD CONSTRAINT "agent_elicitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_elicitation" ADD CONSTRAINT "agent_elicitation_asked_user_id_user_id_fk" FOREIGN KEY ("asked_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_elicitation" ADD CONSTRAINT "agent_elicitation_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_presence" ADD CONSTRAINT "athena_presence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_elicitation_activity_uq" ON "agent_elicitation" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "agent_elicitation_session_idx" ON "agent_elicitation" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_elicitation_task_idx" ON "agent_elicitation" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_elicitation_pending_deadline_idx" ON "agent_elicitation" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "agent_elicitation_asked_idx" ON "agent_elicitation" USING btree ("asked_user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "athena_presence_focused_idx" ON "athena_presence" USING btree ("focused_at");