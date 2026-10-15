ALTER TABLE "process_occurrence" ADD COLUMN "blueprint_applied_at" timestamp with time zone;--> statement-breakpoint
CREATE FUNCTION docket_guard_retained_occurrence_applied() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.blueprint_applied_at IS NOT NULL AND (NEW.blueprint_applied_at,NEW.blueprint_invocation_id,NEW.organization_id,NEW.series_id,NEW.series_revision_id) IS DISTINCT FROM (OLD.blueprint_applied_at,OLD.blueprint_invocation_id,OLD.organization_id,OLD.series_id,OLD.series_revision_id) THEN
    RAISE EXCEPTION 'Accepted retained occurrence application is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.blueprint_applied_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM work_template_blueprint_invocation AS invocation_row
    JOIN recurrence_series_revision AS series_row ON series_row.id=NEW.series_revision_id AND series_row.organization_id=NEW.organization_id AND series_row.series_id=NEW.series_id
    JOIN process_instance AS instance_row ON instance_row.occurrence_id=NEW.id AND instance_row.organization_id=NEW.organization_id AND instance_row.revision_id=series_row.process_revision_id
    WHERE invocation_row.id=NEW.blueprint_invocation_id AND invocation_row.organization_id=NEW.organization_id
      AND invocation_row.manifest->>'kind'='published' AND invocation_row.manifest->>'legacyProcessRevisionId'=instance_row.revision_id
      AND series_row.blueprint_invocation_id=invocation_row.id
  ) THEN
    RAISE EXCEPTION 'Invalid retained occurrence application binding' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER retained_occurrence_applied_guard BEFORE INSERT OR UPDATE ON process_occurrence FOR EACH ROW EXECUTE FUNCTION docket_guard_retained_occurrence_applied();

--> statement-breakpoint
CREATE OR REPLACE VIEW docket_retained_date_sources WITH (security_invoker=true) AS
SELECT o.organization_id, o.id AS occurrence_id, mapped.step_id AS source_step_id,
       date_field.field, invocation.id AS invocation_id, mapped.work_kind, mapped.work_id,
       md5(jsonb_build_array(o.organization_id,o.id,mapped.step_id,date_field.field,invocation.id,mapped.work_kind,mapped.work_id,preset.value)::text) AS source_fingerprint
FROM process_occurrence o
JOIN recurrence_series_revision series_revision ON series_revision.id=o.series_revision_id AND series_revision.organization_id=o.organization_id
JOIN process_instance instance ON instance.occurrence_id=o.id AND instance.organization_id=o.organization_id AND instance.revision_id=series_revision.process_revision_id
JOIN work_template_blueprint_invocation invocation ON invocation.id=coalesce(o.blueprint_invocation_id,series_revision.blueprint_invocation_id) AND invocation.organization_id=o.organization_id AND invocation.manifest->>'kind'='published' AND invocation.manifest->>'legacyProcessRevisionId'=instance.revision_id
JOIN (
 SELECT m.organization_id,m.instance_id,m.step_id,'project'::text AS work_kind,m.project_id AS work_id FROM process_instance_project m JOIN project w ON w.id=m.project_id AND w.organization_id=m.organization_id
 UNION ALL SELECT m.organization_id,m.instance_id,m.step_id,'milestone'::text,m.milestone_id FROM process_instance_milestone m JOIN milestone w ON w.id=m.milestone_id AND w.organization_id=m.organization_id
 UNION ALL SELECT m.organization_id,m.instance_id,m.step_id,'task'::text,m.task_id FROM process_instance_task m JOIN task w ON w.id=m.task_id AND w.organization_id=m.organization_id
) mapped ON mapped.instance_id=instance.id AND mapped.organization_id=o.organization_id
JOIN process_step source_step ON source_step.id=mapped.step_id AND source_step.organization_id=o.organization_id AND source_step.revision_id=instance.revision_id AND source_step.kind::text=mapped.work_kind
CROSS JOIN LATERAL jsonb_array_elements(invocation.overrides) AS preset(value)
CROSS JOIN (VALUES ('startDate','start_offset_days'),('dueDate','due_offset_days'),('targetDate','target_offset_days')) AS date_field(field,offset_key)
WHERE preset.value->>'sourceStepId'=mapped.step_id AND preset.value->>'kind'=mapped.work_kind
AND EXISTS (SELECT 1 FROM jsonb_array_elements(invocation.manifest->'steps') AS manifest_step(value) WHERE manifest_step.value->>'sourceStepId'=mapped.step_id)
AND (jsonb_typeof(preset.value->'fields'->date_field.offset_key)='number' OR (((mapped.work_kind='project' AND date_field.field='startDate') OR (mapped.work_kind='milestone' AND date_field.field='targetDate') OR (mapped.work_kind='task' AND date_field.field='dueDate')) AND ((preset.value->'fields'->date_field.offset_key) IS NULL OR jsonb_typeof(preset.value->'fields'->date_field.offset_key)='null')))
AND ((mapped.work_kind='task' AND date_field.field IN ('startDate','dueDate')) OR (mapped.work_kind='project' AND date_field.field IN ('startDate','targetDate')) OR (mapped.work_kind='milestone' AND date_field.field='targetDate'));
