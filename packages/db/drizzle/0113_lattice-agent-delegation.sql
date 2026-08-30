CREATE TABLE "agent_delegation" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"session_id" text NOT NULL,
	"task_id" text,
	"connection_id" text NOT NULL,
	"runtime_id" text NOT NULL,
	"logical_submission_id" text NOT NULL,
	"work_id" text NOT NULL,
	"reply_key_ciphertext" text,
	"status" text DEFAULT 'prepared' NOT NULL,
	"work_state" text,
	"relay_cursor" text DEFAULT 'cursor_0' NOT NULL,
	"next_poll_at" timestamp,
	"deadline_at" timestamp,
	"failure_code" text,
	"terminal_outcome" jsonb,
	"returned_activity_id" text,
	"result_acknowledged_at" timestamp,
	"submitted_at" timestamp,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_delegation_status_check" CHECK ("agent_delegation"."status" in ('prepared','submitted','proposed','completed','failed','canceled')),
	CONSTRAINT "agent_delegation_cursor_check" CHECK (char_length("agent_delegation"."relay_cursor") > 0),
	CONSTRAINT "agent_delegation_reply_key_lifecycle_check" CHECK (("agent_delegation"."status" in ('prepared','submitted') AND "agent_delegation"."reply_key_ciphertext" IS NOT NULL)
        OR ("agent_delegation"."status" in ('proposed','completed','failed','canceled') AND "agent_delegation"."reply_key_ciphertext" IS NULL)),
	CONSTRAINT "agent_delegation_terminal_shape_check" CHECK ("agent_delegation"."status" in ('prepared','submitted')
        OR ("agent_delegation"."status" in ('proposed','completed') AND "agent_delegation"."terminal_outcome" IS NOT NULL)
        OR ("agent_delegation"."status" = 'failed' AND "agent_delegation"."failure_code" IS NOT NULL)
        OR "agent_delegation"."status" = 'canceled'),
	CONSTRAINT "agent_delegation_returned_activity_shape_check" CHECK (("agent_delegation"."status" in ('proposed','completed') AND "agent_delegation"."returned_activity_id" IS NOT NULL)
        OR ("agent_delegation"."status" in ('prepared','submitted','failed','canceled') AND "agent_delegation"."returned_activity_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "execution_surface" text DEFAULT 'docket' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_id_owner_context_org_uq" UNIQUE("id","owner_user_id","context_organization_id");--> statement-breakpoint
ALTER TABLE "athena_assignment" ADD CONSTRAINT "athena_assignment_id_owner_org_uq" UNIQUE("id","owner_user_id","organization_id");--> statement-breakpoint
ALTER TABLE "session_activity" ADD CONSTRAINT "session_activity_id_session_uq" UNIQUE("id","session_id");--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_assignment_owner_org_fk" FOREIGN KEY ("assignment_id","owner_user_id","organization_id") REFERENCES "public"."athena_assignment"("id","owner_user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_session_owner_org_fk" FOREIGN KEY ("session_id","owner_user_id","organization_id") REFERENCES "public"."agent_session"("id","owner_user_id","context_organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_connection_owner_fk" FOREIGN KEY ("connection_id","owner_user_id") REFERENCES "public"."lattice_connection"("id","owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_returned_activity_session_fk" FOREIGN KEY ("returned_activity_id","session_id") REFERENCES "public"."session_activity"("id","session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_delegation_open_assignment_uq" ON "agent_delegation" USING btree ("assignment_id") WHERE "agent_delegation"."status" in ('prepared','submitted','proposed');--> statement-breakpoint
CREATE UNIQUE INDEX "agent_delegation_logical_submission_uq" ON "agent_delegation" USING btree ("logical_submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_delegation_work_uq" ON "agent_delegation" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_due_idx" ON "agent_delegation" USING btree ("status","next_poll_at");--> statement-breakpoint
CREATE INDEX "agent_delegation_owner_idx" ON "agent_delegation" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "agent_delegation_organization_idx" ON "agent_delegation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_task_idx" ON "agent_delegation" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_assignment_owner_org_idx" ON "agent_delegation" USING btree ("assignment_id","owner_user_id","organization_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_session_owner_org_idx" ON "agent_delegation" USING btree ("session_id","owner_user_id","organization_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_connection_owner_idx" ON "agent_delegation" USING btree ("connection_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_returned_activity_session_idx" ON "agent_delegation" USING btree ("returned_activity_id","session_id");--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_execution_surface_check" CHECK ("agent_session"."execution_surface" in ('docket','lattice'));
