CREATE OR REPLACE FUNCTION docket_private_root_placements (document jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry jsonb; parent jsonb; field_name text; expected_kind text; actual_kind text;
BEGIN
 IF NOT (document ? 'placements') THEN RETURN true; END IF;
 IF jsonb_typeof(document->'placements')<>'array' OR jsonb_array_length(document->'placements')>500 THEN RETURN false; END IF;
 IF (SELECT count(*)<>count(DISTINCT value->>'rootKey') FROM jsonb_array_elements(document->'placements')) THEN RETURN false; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(document->'placements') LOOP
  IF jsonb_typeof(entry)<>'object' OR NOT (entry ? 'rootKey') OR (SELECT count(*) FROM jsonb_object_keys(entry))<2
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) field WHERE field NOT IN('rootKey','project','milestone','parentTask'))
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(document->'roots') root WHERE root->>'key'=entry->>'rootKey' AND coalesce(root->'root'->>'kind',root->'draft'->'root'->>'kind')='task') THEN RETURN false; END IF;
  FOREACH field_name IN ARRAY ARRAY['project','milestone','parentTask'] LOOP
   IF NOT (entry ? field_name) THEN CONTINUE; END IF;
   parent:=entry->field_name;
   IF NOT docket_schedule_v2_ref(parent,document) THEN RETURN false; END IF;
   IF parent->'path'='[]'::jsonb THEN
    expected_kind:=CASE WHEN field_name='parentTask' THEN 'task' ELSE field_name END;
    SELECT coalesce(root->'root'->>'kind',root->'draft'->'root'->>'kind') INTO actual_kind FROM jsonb_array_elements(document->'roots') root WHERE root->>'key'=parent->>'rootKey';
    IF actual_kind IS DISTINCT FROM expected_kind THEN RETURN false; END IF;
   END IF;
  END LOOP;
 END LOOP;
 RETURN NOT EXISTS(WITH RECURSIVE edges AS (
  SELECT placement_entry.value->>'rootKey' AS target,parent_ref.value->>'rootKey' AS source FROM jsonb_array_elements(document->'placements') placement_entry(value)
   CROSS JOIN LATERAL jsonb_each(placement_entry.value-'rootKey') parent_ref(key,value)
 ), reach(target,source) AS (
  SELECT target,source FROM edges UNION SELECT reach.target,edges.source FROM reach JOIN edges ON edges.target=reach.source
 ) SELECT 1 FROM reach WHERE target=source);
 EXCEPTION WHEN others THEN RETURN false;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_guard_schedule_root_placements () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; entry jsonb; root_id text; actual_row task; parent_id text;
BEGIN
 IF NEW.accepted_claim IS NULL OR NEW.blueprint_applied_at IS NULL THEN RETURN NEW; END IF;
 -- Physical placement is a creation proof. Ordinary later hierarchy changes do
 -- not revoke an accepted occurrence or prevent date pins and authorized Undo.
 IF TG_OP='UPDATE' AND OLD.blueprint_applied_at IS NOT NULL
  AND ROW(NEW.id,NEW.organization_id,NEW.series_id,NEW.series_revision_id,NEW.run_kind,NEW.accepted_claim,NEW.blueprint_root_refs,NEW.blueprint_applied_at)
   IS NOT DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.series_id,OLD.series_revision_id,OLD.run_kind,OLD.accepted_claim,OLD.blueprint_root_refs,OLD.blueprint_applied_at)
 THEN RETURN NEW; END IF;
 SELECT schedule_draft INTO document FROM recurrence_series_revision WHERE id=NEW.series_revision_id AND series_id=NEW.series_id AND organization_id=NEW.organization_id;
 IF NOT (document ? 'placements') THEN RETURN NEW; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(document->'placements') LOOP
   root_id:=docket_schedule_qualified_actual(NEW.blueprint_root_refs,jsonb_build_object('rootKey',entry->'rootKey','path','[]'::jsonb),'task');
   SELECT * INTO actual_row FROM task WHERE id=root_id AND organization_id=NEW.organization_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Private root placement requires its actual selected Task' USING ERRCODE='23514',CONSTRAINT='schedule_root_placement_actual'; END IF;
   IF entry ? 'project' THEN
    parent_id:=docket_schedule_qualified_actual(NEW.blueprint_root_refs,entry->'project','project');
    IF parent_id IS NULL OR actual_row.project_id IS DISTINCT FROM parent_id THEN RAISE EXCEPTION 'Private root Project placement changed' USING ERRCODE='23514',CONSTRAINT='schedule_root_placement_actual'; END IF;
   END IF;
   IF entry ? 'milestone' THEN
    parent_id:=docket_schedule_qualified_actual(NEW.blueprint_root_refs,entry->'milestone','milestone');
    IF parent_id IS NULL OR actual_row.milestone_id IS DISTINCT FROM parent_id THEN RAISE EXCEPTION 'Private root Milestone placement changed' USING ERRCODE='23514',CONSTRAINT='schedule_root_placement_actual'; END IF;
   END IF;
   IF entry ? 'parentTask' THEN
    parent_id:=docket_schedule_qualified_actual(NEW.blueprint_root_refs,entry->'parentTask','task');
    IF parent_id IS NULL OR actual_row.parent_task_id IS DISTINCT FROM parent_id THEN RAISE EXCEPTION 'Private root Task placement changed' USING ERRCODE='23514',CONSTRAINT='schedule_root_placement_actual'; END IF;
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
