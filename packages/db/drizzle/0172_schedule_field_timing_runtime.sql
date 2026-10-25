-- Add bound field/title/completion semantics without activating any retained revision or occurrence.
CREATE FUNCTION docket_schedule_v2_ref (
  input_ref jsonb,
  document jsonb,
  needs_field boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 RETURN coalesce(docket_schedule_keys(input_ref,CASE WHEN needs_field THEN ARRAY['rootKey','path','field'] ELSE ARRAY['rootKey','path'] END)
  AND input_ref->>'rootKey' ~ '^[a-z][a-z0-9_-]{0,63}$'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(document->'roots') root WHERE root->>'key'=input_ref->>'rootKey')
  AND jsonb_typeof(input_ref->'path')='array' AND jsonb_array_length(input_ref->'path')<=499
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(input_ref->'path') part WHERE jsonb_typeof(part)<>'string' OR part#>>'{}' !~ '^[a-z][a-z0-9_-]{0,63}$')
  AND (NOT needs_field OR input_ref->>'field' IN('startDate','dueDate','targetDate')),false);
 EXCEPTION WHEN others THEN RETURN false;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_schedule_v2_source (input_source jsonb, document jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF input_source->>'kind'='run' THEN RETURN coalesce(docket_schedule_keys(input_source,ARRAY['kind']),false); END IF;
 IF input_source->>'kind'='work_date' THEN RETURN coalesce(docket_schedule_keys(input_source,ARRAY['kind','work','field']) AND docket_schedule_v2_ref(input_source->'work',document)
   AND input_source->>'field' IN('startDate','dueDate','targetDate'),false); END IF;
 RETURN coalesce(input_source->>'kind'='after_completion' AND docket_schedule_keys(input_source,ARRAY['kind','works'])
   AND jsonb_typeof(input_source->'works')='array' AND jsonb_array_length(input_source->'works') BETWEEN 1 AND 499
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(input_source->'works') ref WHERE NOT docket_schedule_v2_ref(ref,document))
   AND (SELECT count(*)=count(DISTINCT ref) FROM jsonb_array_elements(input_source->'works') ref),false);
 EXCEPTION WHEN others THEN RETURN false;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_schedule_v2_shape (document jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE root jsonb; rule jsonb; entry jsonb;
BEGIN
 IF NOT coalesce(docket_schedule_keys(document,ARRAY['kind','revision','state','creationMode','roots','dependencies','timing','absentFields','titlePolicy','titles','completionPolicy'])
   AND document->>'kind'='forest' AND document->'revision'='2'::jsonb AND document->>'state' IN('published','pending_draft')
   AND document->>'creationMode' IN('all_at_once','when_ready') AND jsonb_typeof(document->'roots')='array'
   AND jsonb_array_length(document->'roots') BETWEEN 1 AND 500
   AND (SELECT count(*)=count(DISTINCT r->>'key') AND count(DISTINCT r->'draft'->>'timezone')=1 FROM jsonb_array_elements(document->'roots') r),false) THEN RETURN false; END IF;
 FOR root IN SELECT value FROM jsonb_array_elements(document->'roots') LOOP
   IF NOT coalesce(docket_schedule_keys(root,ARRAY['key','draft']) AND root->>'key' ~ '^[a-z][a-z0-9_-]{0,63}$'
    AND docket_schedule_keys(root->'draft',ARRAY['kind','revision','template','titlePattern','timezone','root','stepOverrides','optionalChoices'])
    AND root->'draft'->>'kind'='schedule' AND root->'draft'->'revision'='1'::jsonb
    AND root->'draft'->'root'->>'kind' IN('task','project')
    AND root->'draft'->'template'->>'targetType'=root->'draft'->'root'->>'kind'
    AND jsonb_typeof(root->'draft'->'timezone')='string' AND length(root->'draft'->>'timezone')>0
    AND jsonb_typeof(root->'draft'->'stepOverrides')='array' AND jsonb_array_length(root->'draft'->'stepOverrides')<=499
    AND jsonb_typeof(root->'draft'->'optionalChoices')='array' AND jsonb_array_length(root->'draft'->'optionalChoices')<=499,false) THEN RETURN false; END IF;
 END LOOP;
 IF NOT coalesce(docket_schedule_keys(document->'timing',ARRAY['kind','revision','rules']) AND document->'timing'->>'kind'='field_timing'
   AND document->'timing'->'revision'='2'::jsonb AND jsonb_typeof(document->'timing'->'rules')='array' AND jsonb_array_length(document->'timing'->'rules')<=1000
   AND jsonb_typeof(document->'absentFields')='array' AND jsonb_array_length(document->'absentFields')<=1000
   AND (SELECT count(*)=count(DISTINCT target) FROM (SELECT value->'target' target FROM jsonb_array_elements(document->'timing'->'rules') UNION ALL SELECT value FROM jsonb_array_elements(document->'absentFields')) fields),false) THEN RETURN false; END IF;
 FOR rule IN SELECT value FROM jsonb_array_elements(document->'timing'->'rules') LOOP
   IF NOT coalesce(docket_schedule_keys(rule,ARRAY['target','source','offset']) AND docket_schedule_v2_ref(rule->'target',document,true)
    AND docket_schedule_v2_source(rule->'source',document) AND docket_schedule_keys(rule->'offset',ARRAY['days','unit'])
    AND jsonb_typeof(rule->'offset'->'days')='number' AND rule->'offset'->>'days' ~ '^-?[0-9]+$'
    AND (rule->'offset'->>'days')::integer BETWEEN -36500 AND 36500 AND rule->'offset'->>'unit' IN('calendar','working')
    AND (rule->'source'->>'kind'<>'after_completion' OR (rule->'offset'->>'days')::integer>=0),false) THEN RETURN false; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(document->'absentFields') ref WHERE NOT docket_schedule_v2_ref(ref,document,true)) THEN RETURN false; END IF;
 IF NOT coalesce(jsonb_typeof(document->'dependencies')='array' AND jsonb_array_length(document->'dependencies')<=500
   AND (SELECT count(*)=count(DISTINCT dependency) FROM jsonb_array_elements(document->'dependencies') dependency),false) THEN RETURN false; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(document->'dependencies') LOOP
   IF NOT coalesce(docket_schedule_keys(entry,ARRAY['blocker','blocked']) AND docket_schedule_v2_ref(entry->'blocker',document)
    AND docket_schedule_v2_ref(entry->'blocked',document) AND entry->'blocker'<>entry->'blocked',false) THEN RETURN false; END IF;
 END LOOP;
 IF NOT coalesce(docket_schedule_keys(document->'titlePolicy',ARRAY['kind','revision']) AND document->'titlePolicy'->>'kind' IN('native_title','legacy_title')
   AND document->'titlePolicy'->'revision'='1'::jsonb AND jsonb_typeof(document->'titles')='array' AND jsonb_array_length(document->'titles')<=500
   AND (document->'titlePolicy'->>'kind'='legacy_title' OR jsonb_array_length(document->'titles')=0)
   AND (SELECT count(*)=count(DISTINCT title->'target') FROM jsonb_array_elements(document->'titles') title),false) THEN RETURN false; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(document->'titles') LOOP
   IF NOT coalesce(docket_schedule_keys(entry,ARRAY['target','kind','pattern']) AND docket_schedule_v2_ref(entry->'target',document)
    AND entry->>'kind' IN('task','project','milestone') AND jsonb_typeof(entry->'pattern')='string',false) THEN RETURN false; END IF;
 END LOOP;
 IF document->'titlePolicy'->>'kind'='legacy_title' AND EXISTS(SELECT 1 FROM jsonb_array_elements(document->'roots') r WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(document->'titles') t WHERE t->'target'->>'rootKey'=r->>'key' AND t->'target'->'path'='[]'::jsonb AND t->>'kind'=r->'draft'->'root'->>'kind')) THEN RETURN false; END IF;
 IF document->'completionPolicy'->>'kind'='terminal_actual_tree' THEN RETURN coalesce(docket_schedule_keys(document->'completionPolicy',ARRAY['kind','revision']) AND document->'completionPolicy'->'revision'='1'::jsonb,false); END IF;
 RETURN coalesce(docket_schedule_keys(document->'completionPolicy',ARRAY['kind','revision','tasks']) AND document->'completionPolicy'->>'kind'='legacy_authored_tasks'
   AND document->'completionPolicy'->'revision'='1'::jsonb AND jsonb_typeof(document->'completionPolicy'->'tasks')='array' AND jsonb_array_length(document->'completionPolicy'->'tasks')<=500
   AND (SELECT count(*)=count(DISTINCT ref) FROM jsonb_array_elements(document->'completionPolicy'->'tasks') ref)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(document->'completionPolicy'->'tasks') ref WHERE NOT docket_schedule_v2_ref(ref,document)),false);
 EXCEPTION WHEN others THEN RETURN false;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_native_schedule_field_date (
  org_id text,
  work_kind text,
  work_id text,
  field text
) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE actual_date text; present boolean;
BEGIN
 IF work_kind='task' AND field IN('startDate','dueDate') THEN SELECT true,(CASE WHEN field='startDate' THEN start_date ELSE due_date END)::date::text INTO present,actual_date FROM task WHERE organization_id=org_id AND id=work_id;
 ELSIF work_kind='project' AND field IN('startDate','targetDate') THEN SELECT true,(CASE WHEN field='startDate' THEN start_date ELSE target_date END)::date::text INTO present,actual_date FROM project WHERE organization_id=org_id AND id=work_id;
 ELSIF work_kind='milestone' AND field='targetDate' THEN SELECT true,target_date::date::text INTO present,actual_date FROM milestone WHERE organization_id=org_id AND id=work_id; END IF;
 IF NOT coalesce(present,false) THEN RAISE EXCEPTION 'Private date field requires its same-tenant accepted work' USING ERRCODE='23514',CONSTRAINT='schedule_date_actual'; END IF;
 RETURN actual_date;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_native_schedule_field_entry (
  org_id text,
  document jsonb,
  roots jsonb,
  target jsonb,
  anchor jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE actual jsonb; draft jsonb; authored jsonb; manual boolean; current_date_value text;
BEGIN
 actual:=docket_native_schedule_actual(roots,target->>'rootKey',target->'path');
 SELECT value->'draft' INTO draft FROM jsonb_array_elements(document->'roots') WHERE value->>'key'=target->>'rootKey';
 IF target->'path'='[]'::jsonb THEN authored:=draft->'root'->'dates'; ELSE SELECT value->'dates' INTO authored FROM jsonb_array_elements(draft->'stepOverrides') WHERE value->'path'=target->'path'; END IF;
 manual:=coalesce(authored ? (target->>'field'),false);
 current_date_value:=docket_native_schedule_field_date(org_id,actual->>'kind',actual->>'id',target->>'field');
 IF anchor->>'kind'='absent' AND NOT manual AND current_date_value IS NOT NULL THEN RAISE EXCEPTION 'Absent private dates cannot inherit a native default' USING ERRCODE='23514',CONSTRAINT='schedule_dates_registration'; END IF;
 RETURN actual || target || jsonb_build_object('anchor',anchor,'manual',manual,'lastDerivedDate',current_date_value);
END $$;

--> statement-breakpoint
ALTER FUNCTION docket_native_schedule_date_policy (text, jsonb, jsonb)
RENAME TO docket_native_schedule_date_policy_v1;

--> statement-breakpoint
CREATE FUNCTION docket_native_schedule_date_policy (org_id text, document jsonb, roots jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE policy jsonb:='[]'::jsonb; rule jsonb; target jsonb; source jsonb; selected jsonb;
BEGIN
 IF document->'revision'<>'2'::jsonb THEN RETURN docket_native_schedule_date_policy_v1(org_id,document,roots); END IF;
 IF NOT docket_schedule_v2_shape(document) THEN RAISE EXCEPTION 'Invalid bound private schedule' USING ERRCODE='23514',CONSTRAINT='schedule_draft_shape'; END IF;
 FOR rule IN SELECT value FROM jsonb_array_elements(document->'timing'->'rules') LOOP
   source:=rule->'source';
   IF source->>'kind'='work_date' THEN
     selected:=docket_native_schedule_actual(roots,source->'work'->>'rootKey',source->'work'->'path');
     PERFORM docket_native_schedule_field_date(org_id,selected->>'kind',selected->>'id',source->>'field');
     source:=jsonb_build_object('kind','work_date','work',selected,'field',source->>'field');
   ELSIF source->>'kind'='after_completion' THEN
     SELECT jsonb_build_object('kind','after_completion','works',jsonb_agg(docket_native_schedule_actual(roots,ref->>'rootKey',ref->'path') ORDER BY position)) INTO source FROM jsonb_array_elements(source->'works') WITH ORDINALITY refs(ref,position);
   END IF;
   policy:=policy || jsonb_build_array(docket_native_schedule_field_entry(org_id,document,roots,rule->'target',jsonb_build_object('kind','field','source',source,'offset',rule->'offset')));
 END LOOP;
 FOR target IN SELECT value FROM jsonb_array_elements(document->'absentFields') LOOP
   policy:=policy || jsonb_build_array(docket_native_schedule_field_entry(org_id,document,roots,target,'{"kind":"absent"}'::jsonb));
 END LOOP;
 RETURN policy;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_schedule_revision_guard () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fallback jsonb; draft_root jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.schedule_draft IS NOT NULL AND NEW.schedule_draft IS DISTINCT FROM OLD.schedule_draft THEN
  RAISE EXCEPTION 'Canonical schedule draft is immutable; append a revision' USING ERRCODE='23514',CONSTRAINT='schedule_draft_immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.authoring_fallback IS NOT NULL AND NEW.authoring_fallback IS DISTINCT FROM OLD.authoring_fallback THEN
  RAISE EXCEPTION 'Authoring fallback is immutable' USING ERRCODE='23514',CONSTRAINT='schedule_fallback_immutable'; END IF;
 IF NEW.schedule_draft IS NOT NULL AND NOT (coalesce(NEW.schedule_draft->>'revision'='1' AND (
  (NEW.schedule_draft->>'kind'='schedule' AND docket_schedule_keys(NEW.schedule_draft,ARRAY['kind','revision','template','titlePattern','timezone','root','stepOverrides','optionalChoices'])
   AND NEW.schedule_draft->'template'->>'targetType'=NEW.schedule_draft->'root'->>'kind')
  OR (NEW.schedule_draft->>'kind'='forest' AND docket_schedule_keys(NEW.schedule_draft,ARRAY['kind','revision','state','roots','dependencies','timing'])
   AND NEW.schedule_draft->>'state' IN('published','pending_draft') AND jsonb_typeof(NEW.schedule_draft->'roots')='array'
   AND jsonb_array_length(NEW.schedule_draft->'roots') BETWEEN 1 AND 500)),false) OR docket_schedule_v2_shape(NEW.schedule_draft)) THEN
  RAISE EXCEPTION 'Invalid canonical schedule draft' USING ERRCODE='23514',CONSTRAINT='schedule_draft_shape'; END IF;
 IF NEW.schedule_draft->>'kind'='schedule' THEN
  PERFORM docket_validate_schedule_template(NEW.schedule_draft->'template',NEW.organization_id);
 ELSIF NEW.schedule_draft->>'kind'='forest' THEN
  FOR draft_root IN SELECT * FROM jsonb_array_elements(NEW.schedule_draft->'roots') LOOP
   PERFORM docket_validate_schedule_template(draft_root->'draft'->'template',NEW.organization_id);
  END LOOP;
 END IF;
 fallback:=NEW.authoring_fallback;
 IF fallback IS NOT NULL AND (TG_OP='INSERT' OR OLD.authoring_fallback IS NULL) THEN
  IF NEW.schedule_draft IS NULL OR NOT coalesce(docket_schedule_keys(fallback,ARRAY['kind','revision','seriesRevisionId','sourceInvocationId','draftFingerprint','roots'])
    AND fallback->>'kind'='schedule_fallback' AND fallback->>'revision'='1' AND fallback->>'seriesRevisionId'=NEW.id
    AND (fallback->>'sourceInvocationId') IS NOT DISTINCT FROM NEW.blueprint_invocation_id
    AND fallback->>'draftFingerprint'=docket_schedule_fingerprint(NEW.schedule_draft),false) THEN
   RAISE EXCEPTION 'Fallback does not match persisted schedule' USING ERRCODE='23514',CONSTRAINT='schedule_fallback_registration'; END IF;
  PERFORM docket_validate_schedule_roots(fallback->'roots',NEW.organization_id);
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_native_schedule_dates_guard () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; expected jsonb; entry jsonb; previous jsonb; expected_sorted jsonb; actual_sorted jsonb;
BEGIN
  IF NEW.schedule_date_ownership IS NULL THEN
    IF TG_OP='UPDATE' AND OLD.schedule_date_ownership IS NOT NULL THEN RAISE EXCEPTION 'Native date ownership cannot be cleared' USING ERRCODE='23514',CONSTRAINT='schedule_dates_immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.accepted_claim IS NULL OR NEW.blueprint_applied_at IS NULL OR NEW.blueprint_root_refs IS NULL OR NEW.run_kind<>'scheduled'
    OR jsonb_typeof(NEW.schedule_date_ownership)<>'array' OR jsonb_array_length(NEW.schedule_date_ownership)>1000 THEN
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
      OR jsonb_typeof(entry->'manual')<>'boolean' OR NOT coalesce((entry->>'kind'='task' AND entry->>'field' IN('startDate','dueDate')) OR (entry->>'kind'='project' AND entry->>'field' IN('startDate','targetDate')) OR (entry->>'kind'='milestone' AND entry->>'field'='targetDate'),false)
      OR NOT (entry->'lastDerivedDate'='null'::jsonb OR (jsonb_typeof(entry->'lastDerivedDate')='string' AND entry->>'lastDerivedDate' ~ '^\d{4}-\d{2}-\d{2}$' AND (entry->>'lastDerivedDate')::date BETWEEN '1970-01-01'::date AND '2200-12-31'::date)) THEN
      RAISE EXCEPTION 'Malformed native date ownership' USING ERRCODE='23514',CONSTRAINT='schedule_dates_shape';
    END IF;
    IF TG_OP='UPDATE' AND OLD.schedule_date_ownership IS NOT NULL THEN
      SELECT value INTO previous FROM jsonb_array_elements(OLD.schedule_date_ownership) WHERE value->>'id'=entry->>'id' AND value->>'field'=entry->>'field';
      IF previous->'manual'='true'::jsonb AND entry->'manual'<>'true'::jsonb AND NOT docket_native_schedule_date_undo_matches(NEW.organization_id,NEW.id,previous,entry) THEN RAISE EXCEPTION 'Explicit native date pin cannot be released implicitly' USING ERRCODE='23514',CONSTRAINT='schedule_dates_manual'; END IF;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT (value->>'id',value->>'field'))<>count(*) FROM jsonb_array_elements(NEW.schedule_date_ownership)) THEN
    RAISE EXCEPTION 'Duplicate native date ownership' USING ERRCODE='23514',CONSTRAINT='schedule_dates_shape';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_schedule_v2_context_guard () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; saved_timezone text;
BEGIN
 IF NEW.accepted_claim IS NULL THEN RETURN NEW; END IF;
 SELECT schedule_draft INTO document FROM recurrence_series_revision WHERE id=NEW.series_revision_id AND series_id=NEW.series_id AND organization_id=NEW.organization_id;
 IF document->'revision'='2'::jsonb THEN
   saved_timezone:=document->'roots'->0->'draft'->>'timezone';
   IF NEW.accepted_claim->>'timezone' IS DISTINCT FROM saved_timezone THEN RAISE EXCEPTION 'Accepted private fields require their saved schedule timezone' USING ERRCODE='23514',CONSTRAINT='schedule_v2_context'; END IF;
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER schedule_v2_context_guard
BEFORE INSERT OR UPDATE OF accepted_claim ON process_occurrence FOR EACH ROW
EXECUTE FUNCTION docket_schedule_v2_context_guard ();
