-- Scope privacy follows the existing explicit-allow evaluator, including live actor and grant expiry.
CREATE FUNCTION docket_schedule_scope_capability(tenant text,program_key text,required text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT tenant=nullif(current_setting('docket.organization_id',true),'') AND EXISTS(
  SELECT 1 FROM actor a LEFT JOIN role r ON r.id=a.role_id AND r.organization_id=a.organization_id
  JOIN "grant" g ON g.organization_id=a.organization_id
    AND ((g.subject_kind='actor' AND g.subject_id=a.id) OR (g.subject_kind='role' AND g.subject_id=r.id))
  WHERE a.id=nullif(current_setting('docket.actor_id',true),'') AND a.organization_id=tenant
    AND a.status='active' AND a.archived_at IS NULL AND g.effect='allow' AND (g.expires_at IS NULL OR g.expires_at>=now())
    AND ((g.resource_kind='organization' AND g.resource_id=tenant AND (program_key IS NULL OR g.cascades))
      OR (program_key IS NOT NULL AND g.resource_kind='program' AND g.resource_id=program_key))
    AND ((required='view' AND jsonb_array_length(g.capabilities)>0) OR (required='manage' AND g.capabilities @> '["manage"]'::jsonb)))
  AND (program_key IS NULL OR EXISTS(SELECT 1 FROM program p WHERE p.id=program_key AND p.organization_id=tenant AND p.archived_at IS NULL))
$$;
--> statement-breakpoint
CREATE FUNCTION docket_schedule_private_scope(tenant text,program_key text,creator text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT docket_schedule_scope_capability(tenant,program_key,'view') AND
  (creator=nullif(current_setting('docket.actor_id',true),'') OR docket_schedule_scope_capability(tenant,program_key,'manage'))
$$;
--> statement-breakpoint
ALTER TABLE recurrence_series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY schedule_series_private ON recurrence_series FOR ALL TO public
USING(docket_schedule_private_scope(organization_id,owner_program_id,created_by))
WITH CHECK(docket_schedule_private_scope(organization_id,owner_program_id,created_by));
--> statement-breakpoint
DROP POLICY schedule_revision_private ON recurrence_series_revision;
--> statement-breakpoint
CREATE POLICY schedule_revision_private ON recurrence_series_revision FOR ALL TO public
USING(EXISTS(SELECT 1 FROM recurrence_series s WHERE s.id=recurrence_series_revision.series_id AND s.organization_id=recurrence_series_revision.organization_id AND docket_schedule_private_scope(s.organization_id,s.owner_program_id,s.created_by)))
WITH CHECK(EXISTS(SELECT 1 FROM recurrence_series s WHERE s.id=recurrence_series_revision.series_id AND s.organization_id=recurrence_series_revision.organization_id AND docket_schedule_private_scope(s.organization_id,s.owner_program_id,s.created_by)));
--> statement-breakpoint
DROP POLICY blueprint_occurrence_private ON process_occurrence;
--> statement-breakpoint
CREATE POLICY blueprint_occurrence_private ON process_occurrence FOR ALL TO public
USING(organization_id=nullif(current_setting('docket.organization_id',true),'') AND (
  (series_id IS NOT NULL AND EXISTS(SELECT 1 FROM recurrence_series s WHERE s.id=process_occurrence.series_id AND s.organization_id=process_occurrence.organization_id AND docket_schedule_private_scope(s.organization_id,s.owner_program_id,s.created_by)))
  OR (series_id IS NULL AND (docket_schedule_scope_capability(organization_id,NULL,'manage') OR
    (docket_schedule_scope_capability(organization_id,NULL,'view') AND EXISTS(SELECT 1 FROM work_template_blueprint_invocation i WHERE i.id=process_occurrence.blueprint_invocation_id AND i.organization_id=process_occurrence.organization_id AND i.owner_actor_id=nullif(current_setting('docket.actor_id',true),'')))))))
WITH CHECK(organization_id=nullif(current_setting('docket.organization_id',true),'') AND (
  (series_id IS NOT NULL AND EXISTS(SELECT 1 FROM recurrence_series s WHERE s.id=process_occurrence.series_id AND s.organization_id=process_occurrence.organization_id AND docket_schedule_private_scope(s.organization_id,s.owner_program_id,s.created_by)))
  OR (series_id IS NULL AND (docket_schedule_scope_capability(organization_id,NULL,'manage') OR
    (docket_schedule_scope_capability(organization_id,NULL,'view') AND EXISTS(SELECT 1 FROM work_template_blueprint_invocation i WHERE i.id=process_occurrence.blueprint_invocation_id AND i.organization_id=process_occurrence.organization_id AND i.owner_actor_id=nullif(current_setting('docket.actor_id',true),'')))))));
--> statement-breakpoint
UPDATE process_occurrence o SET blueprint_invocation_id=c.invocation_id
FROM work_template_blueprint_conversion c
WHERE o.run_kind='historical' AND o.blueprint_invocation_id IS NULL AND o.historical_archive IS NOT NULL
  AND c.organization_id=o.organization_id AND c.legacy_process_revision_id=o.historical_archive->'instance'->>'revision_id'
  AND o.legacy_instance_id=o.historical_archive->'instance'->>'id' AND c.source_archive IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION docket_historical_invocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.run_kind='historical' AND OLD.blueprint_invocation_id IS NOT NULL AND NEW.blueprint_invocation_id IS DISTINCT FROM OLD.blueprint_invocation_id THEN
  RAISE EXCEPTION 'Historical private invocation binding is immutable' USING ERRCODE='23514',CONSTRAINT='historical_invocation_immutable'; END IF;
 IF NEW.run_kind='historical' AND NEW.blueprint_invocation_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM work_template_blueprint_conversion c WHERE c.organization_id=NEW.organization_id AND c.invocation_id=NEW.blueprint_invocation_id
   AND c.legacy_process_revision_id=NEW.historical_archive->'instance'->>'revision_id'
   AND NEW.legacy_instance_id=NEW.historical_archive->'instance'->>'id' AND c.source_archive IS NOT NULL) THEN
  RAISE EXCEPTION 'Historical invocation needs its original immutable source archive' USING ERRCODE='23514',CONSTRAINT='historical_invocation_source'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER historical_invocation_guard BEFORE INSERT OR UPDATE ON process_occurrence FOR EACH ROW EXECUTE FUNCTION docket_historical_invocation_guard();
