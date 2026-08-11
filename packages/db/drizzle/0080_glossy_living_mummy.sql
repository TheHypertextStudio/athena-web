CREATE TABLE "agent_delegation" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"delegate_actor_id" text,
	"session_id" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"surface" text NOT NULL,
	"external_work_id" text NOT NULL,
	"runtime_id" text,
	"runtime_name" text,
	"work_state" text NOT NULL,
	"outcome" text,
	"result_activity_id" text,
	"last_failure_reason" text,
	"last_failure_detail" text,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"last_polled_at" timestamp,
	"deadline_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_delegation_status_check" CHECK ("agent_delegation"."status" in ('submitted','completed','failed')),
	CONSTRAINT "agent_delegation_settled_shape_check" CHECK ("agent_delegation"."status" = 'submitted' OR "agent_delegation"."outcome" IS NOT NULL OR "agent_delegation"."last_failure_reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_delegate_actor_id_actor_id_fk" FOREIGN KEY ("delegate_actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_result_activity_id_session_activity_id_fk" FOREIGN KEY ("result_activity_id") REFERENCES "public"."session_activity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_delegation_open_task_uq" ON "agent_delegation" USING btree ("task_id") WHERE status = 'submitted';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_delegation_work_uq" ON "agent_delegation" USING btree ("surface","external_work_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_status_idx" ON "agent_delegation" USING btree ("status","last_polled_at");--> statement-breakpoint
CREATE INDEX "agent_delegation_owner_idx" ON "agent_delegation" USING btree ("owner_user_id","status");