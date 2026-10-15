-- Retained authoring/archive access follows current grants, never historical role labels.
DROP POLICY invocation_head_private ON work_template_invocation_head;
--> statement-breakpoint
CREATE POLICY invocation_head_private ON work_template_invocation_head FOR ALL TO public
USING(docket_schedule_private_scope(organization_id,NULL,owner_actor_id))
WITH CHECK(docket_schedule_private_scope(organization_id,NULL,owner_actor_id));
--> statement-breakpoint
DROP POLICY blueprint_invocation_private ON work_template_blueprint_invocation;
--> statement-breakpoint
CREATE POLICY blueprint_invocation_private ON work_template_blueprint_invocation FOR ALL TO public
USING(docket_schedule_private_scope(organization_id,NULL,owner_actor_id))
WITH CHECK(docket_schedule_private_scope(organization_id,NULL,owner_actor_id));
