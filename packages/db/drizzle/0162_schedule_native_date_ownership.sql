ALTER TABLE process_occurrence ADD COLUMN schedule_date_ownership jsonb;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN continued_from_occurrence_id text;
--> statement-breakpoint
CREATE UNIQUE INDEX schedule_occurrence_tenant_identity_unique ON process_occurrence(id,organization_id);
--> statement-breakpoint
CREATE UNIQUE INDEX schedule_occurrence_continuation_unique ON process_occurrence(continued_from_occurrence_id);
--> statement-breakpoint
DROP INDEX process_occurrence_revision_date_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX process_occurrence_revision_date_uq ON process_occurrence(series_id,series_revision_id,scheduled_for)
WHERE external_occurrence_key IS NULL AND continued_from_occurrence_id IS NULL;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD CONSTRAINT schedule_occurrence_continuation_tenant_fk
FOREIGN KEY(continued_from_occurrence_id,organization_id) REFERENCES process_occurrence(id,organization_id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION docket_native_schedule_continuation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_run process_occurrence%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND OLD.continued_from_occurrence_id IS DISTINCT FROM NEW.continued_from_occurrence_id THEN
    RAISE EXCEPTION 'Native completion source is immutable' USING ERRCODE='23514',CONSTRAINT='schedule_continuation_immutable';
  END IF;
  IF NEW.continued_from_occurrence_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO source_run FROM process_occurrence WHERE id=NEW.continued_from_occurrence_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF source_run.id IS NULL OR source_run.id=NEW.id OR source_run.series_id IS DISTINCT FROM NEW.series_id
    OR source_run.run_kind<>'scheduled' OR source_run.status<>'completed' OR source_run.completed_at IS NULL
    OR source_run.accepted_claim IS NULL OR source_run.blueprint_applied_at IS NULL OR NEW.run_kind<>'scheduled'
    OR NEW.external_occurrence_key IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM recurrence_series_revision r WHERE r.id=source_run.series_revision_id AND r.organization_id=source_run.organization_id AND r.series_id=source_run.series_id AND r.trigger_kind='after_completion') THEN
    RAISE EXCEPTION 'Native continuation requires its exact completed same-series source' USING ERRCODE='23514',CONSTRAINT='schedule_continuation_source';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER schedule_native_continuation_guard BEFORE INSERT OR UPDATE OF continued_from_occurrence_id ON process_occurrence
FOR EACH ROW EXECUTE FUNCTION docket_native_schedule_continuation_guard();
--> statement-breakpoint
CREATE FUNCTION docket_native_schedule_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.accepted_claim IS NULL THEN RETURN NEW; END IF;
  IF (NEW.id,NEW.organization_id,NEW.series_id,NEW.series_revision_id,NEW.external_occurrence_key)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.series_id,OLD.series_revision_id,OLD.external_occurrence_key)
    OR (OLD.original_scheduled_for IS NOT NULL AND NEW.original_scheduled_for IS DISTINCT FROM OLD.original_scheduled_for)
    OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at)
    OR (OLD.status::text IN('completed','canceled') AND NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'Accepted native occurrence identity and terminal facts are immutable' USING ERRCODE='23514',CONSTRAINT='schedule_native_identity';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER schedule_native_identity_guard BEFORE UPDATE ON process_occurrence
FOR EACH ROW EXECUTE FUNCTION docket_native_schedule_identity_guard();
--> statement-breakpoint
CREATE FUNCTION docket_native_schedule_actual(roots jsonb, root_key text, logical_path jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE root_ref jsonb; actual jsonb;
BEGIN
  SELECT value INTO root_ref FROM jsonb_array_elements(roots) WHERE value->>'key'=root_key;
  IF logical_path='[]'::jsonb THEN
    actual:=jsonb_build_object('kind',root_ref->>'kind','id',root_ref->>'id');
  ELSE
    SELECT jsonb_build_object('kind',value->>'kind','id',value->>'id') INTO actual
      FROM jsonb_array_elements(root_ref->'selectedWork') WHERE value->'path'=logical_path;
  END IF;
  IF actual IS NULL OR actual->>'id' IS NULL OR actual->>'kind' NOT IN('task','project','milestone') THEN
    RAISE EXCEPTION 'Native date ownership requires accepted actual work' USING ERRCODE='23514',CONSTRAINT='schedule_date_actual';
  END IF;
  RETURN actual;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_native_schedule_date(org_id text, work_kind text, work_id text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE actual_date text; present boolean;
BEGIN
  IF work_kind='task' THEN
    SELECT true,due_date::date::text INTO present,actual_date FROM task WHERE organization_id=org_id AND id=work_id;
  ELSIF work_kind='project' THEN
    SELECT true,target_date::date::text INTO present,actual_date FROM project WHERE organization_id=org_id AND id=work_id;
  ELSIF work_kind='milestone' THEN
    SELECT true,target_date::date::text INTO present,actual_date FROM milestone WHERE organization_id=org_id AND id=work_id;
  END IF;
  IF NOT coalesce(present,false) THEN
    RAISE EXCEPTION 'Native date registration work is missing or foreign' USING ERRCODE='23514',CONSTRAINT='schedule_date_actual';
  END IF;
  RETURN actual_date;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_native_schedule_date_entry(org_id text, document jsonb, roots jsonb, root_key text, logical_path jsonb, anchor jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE actual jsonb; draft jsonb; authored jsonb; date_field text;
BEGIN
  actual:=docket_native_schedule_actual(roots,root_key,logical_path);
  IF document->>'kind'='schedule' THEN draft:=document;
  ELSE SELECT value->'draft' INTO draft FROM jsonb_array_elements(document->'roots') WHERE value->>'key'=root_key; END IF;
  date_field:=CASE WHEN actual->>'kind'='task' THEN 'dueDate' ELSE 'targetDate' END;
  IF logical_path='[]'::jsonb THEN authored:=draft->'root'->'dates';
  ELSE SELECT value->'dates' INTO authored FROM jsonb_array_elements(draft->'stepOverrides') WHERE value->'path'=logical_path; END IF;
  RETURN actual || jsonb_build_object('rootKey',root_key,'path',logical_path,'field',date_field,'anchor',anchor,
    'manual',coalesce(authored ? date_field,false),'lastDerivedDate',docket_native_schedule_date(org_id,actual->>'kind',actual->>'id'));
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_native_schedule_date_policy(org_id text, document jsonb, roots jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE policy jsonb:='[]'::jsonb; root_ref jsonb; edge jsonb; source_work jsonb;
BEGIN
  FOR root_ref IN SELECT value FROM jsonb_array_elements(roots) LOOP
    IF document->>'kind'='schedule' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(document->'timing') e WHERE e->'target'->>'rootKey'=root_ref->>'key' AND e->'target'->'path'='[]'::jsonb) THEN
      policy:=policy || jsonb_build_array(docket_native_schedule_date_entry(org_id,document,roots,root_ref->>'key','[]'::jsonb,'{"kind":"run"}'::jsonb));
    END IF;
  END LOOP;
  IF document->>'kind'='forest' THEN
    FOR edge IN SELECT value FROM jsonb_array_elements(document->'timing') LOOP
      source_work:=docket_native_schedule_actual(roots,edge->'prerequisite'->>'rootKey',edge->'prerequisite'->'path');
      policy:=policy || jsonb_build_array(docket_native_schedule_date_entry(org_id,document,roots,edge->'target'->>'rootKey',edge->'target'->'path',
        jsonb_build_object('kind','work','id',source_work->>'id','offsetDays',edge->'offsetDays')));
    END LOOP;
  END IF;
  RETURN policy;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_native_schedule_dates_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; expected jsonb; entry jsonb; previous jsonb; expected_sorted jsonb; actual_sorted jsonb;
BEGIN
  IF NEW.schedule_date_ownership IS NULL THEN
    IF TG_OP='UPDATE' AND OLD.schedule_date_ownership IS NOT NULL THEN RAISE EXCEPTION 'Native date ownership cannot be cleared' USING ERRCODE='23514',CONSTRAINT='schedule_dates_immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.accepted_claim IS NULL OR NEW.blueprint_applied_at IS NULL OR NEW.blueprint_root_refs IS NULL OR NEW.run_kind<>'scheduled'
    OR jsonb_typeof(NEW.schedule_date_ownership)<>'array' OR jsonb_array_length(NEW.schedule_date_ownership)>500 THEN
    RAISE EXCEPTION 'Native dates require applied checked schedule work' USING ERRCODE='23514',CONSTRAINT='schedule_dates_shape';
  END IF;
  IF TG_OP='INSERT' OR OLD.schedule_date_ownership IS NULL THEN
    SELECT schedule_draft INTO document FROM recurrence_series_revision WHERE id=NEW.series_revision_id AND series_id=NEW.series_id AND organization_id=NEW.organization_id;
    IF document IS NULL THEN RAISE EXCEPTION 'Native dates require canonical revision' USING ERRCODE='23514',CONSTRAINT='schedule_dates_shape'; END IF;
    expected:=docket_native_schedule_date_policy(NEW.organization_id,document,NEW.blueprint_root_refs);
    SELECT jsonb_agg(value ORDER BY value->>'id',value->>'field') INTO expected_sorted FROM jsonb_array_elements(expected);
    SELECT jsonb_agg(value ORDER BY value->>'id',value->>'field') INTO actual_sorted FROM jsonb_array_elements(NEW.schedule_date_ownership);
    IF expected_sorted IS DISTINCT FROM actual_sorted THEN RAISE EXCEPTION 'Native dates differ from saved policy and actual work' USING ERRCODE='23514',CONSTRAINT='schedule_dates_registration'; END IF;
  ELSE
    SELECT jsonb_agg(value-'manual'-'lastDerivedDate' ORDER BY value->>'id',value->>'field') INTO expected_sorted FROM jsonb_array_elements(OLD.schedule_date_ownership);
    SELECT jsonb_agg(value-'manual'-'lastDerivedDate' ORDER BY value->>'id',value->>'field') INTO actual_sorted FROM jsonb_array_elements(NEW.schedule_date_ownership);
    IF expected_sorted IS DISTINCT FROM actual_sorted THEN RAISE EXCEPTION 'Native date policy is immutable' USING ERRCODE='23514',CONSTRAINT='schedule_dates_immutable'; END IF;
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(NEW.schedule_date_ownership) LOOP
    IF NOT docket_schedule_keys(entry,ARRAY['rootKey','path','kind','id','field','anchor','manual','lastDerivedDate'])
      OR jsonb_typeof(entry->'manual')<>'boolean' OR entry->>'field' IS DISTINCT FROM (CASE WHEN entry->>'kind'='task' THEN 'dueDate' ELSE 'targetDate' END)
      OR NOT (entry->'lastDerivedDate'='null'::jsonb OR (jsonb_typeof(entry->'lastDerivedDate')='string' AND entry->>'lastDerivedDate' ~ '^\d{4}-\d{2}-\d{2}$' AND (entry->>'lastDerivedDate')::date BETWEEN '1970-01-01'::date AND '2200-12-31'::date)) THEN
      RAISE EXCEPTION 'Malformed native date ownership' USING ERRCODE='23514',CONSTRAINT='schedule_dates_shape';
    END IF;
    IF TG_OP='UPDATE' AND OLD.schedule_date_ownership IS NOT NULL THEN
      SELECT value INTO previous FROM jsonb_array_elements(OLD.schedule_date_ownership) WHERE value->>'id'=entry->>'id' AND value->>'field'=entry->>'field';
      IF previous->'manual'='true'::jsonb AND entry->'manual'<>'true'::jsonb THEN RAISE EXCEPTION 'Explicit native date pin cannot be released implicitly' USING ERRCODE='23514',CONSTRAINT='schedule_dates_manual'; END IF;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT (value->>'id',value->>'field'))<>count(*) FROM jsonb_array_elements(NEW.schedule_date_ownership)) THEN
    RAISE EXCEPTION 'Duplicate native date ownership' USING ERRCODE='23514',CONSTRAINT='schedule_dates_shape';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER schedule_native_dates_guard BEFORE INSERT OR UPDATE OF schedule_date_ownership ON process_occurrence
FOR EACH ROW EXECUTE FUNCTION docket_native_schedule_dates_guard();
