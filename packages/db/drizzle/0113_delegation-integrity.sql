ALTER TABLE "agent_delegation" DROP CONSTRAINT "agent_delegation_returned_activity_id_session_activity_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_delegation" DROP CONSTRAINT "agent_delegation_assignment_owner_fk";
--> statement-breakpoint
ALTER TABLE "agent_delegation" DROP CONSTRAINT "agent_delegation_session_owner_fk";
--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_id_owner_context_org_uq" UNIQUE("id","owner_user_id","context_organization_id");--> statement-breakpoint
ALTER TABLE "athena_assignment" ADD CONSTRAINT "athena_assignment_id_owner_org_uq" UNIQUE("id","owner_user_id","organization_id");--> statement-breakpoint
ALTER TABLE "session_activity" ADD CONSTRAINT "session_activity_id_session_uq" UNIQUE("id","session_id");--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_assignment_owner_org_fk" FOREIGN KEY ("assignment_id","owner_user_id","organization_id") REFERENCES "public"."athena_assignment"("id","owner_user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_session_owner_org_fk" FOREIGN KEY ("session_id","owner_user_id","organization_id") REFERENCES "public"."agent_session"("id","owner_user_id","context_organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_returned_activity_session_fk" FOREIGN KEY ("returned_activity_id","session_id") REFERENCES "public"."session_activity"("id","session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_delegation_organization_idx" ON "agent_delegation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_task_idx" ON "agent_delegation" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_assignment_owner_org_idx" ON "agent_delegation" USING btree ("assignment_id","owner_user_id","organization_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_session_owner_org_idx" ON "agent_delegation" USING btree ("session_id","owner_user_id","organization_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_connection_owner_idx" ON "agent_delegation" USING btree ("connection_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "agent_delegation_returned_activity_session_idx" ON "agent_delegation" USING btree ("returned_activity_id","session_id");--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_returned_activity_shape_check" CHECK (("agent_delegation"."status" in ('proposed','completed') AND "agent_delegation"."returned_activity_id" IS NOT NULL)
        OR ("agent_delegation"."status" in ('prepared','submitted','failed','canceled') AND "agent_delegation"."returned_activity_id" IS NULL));
