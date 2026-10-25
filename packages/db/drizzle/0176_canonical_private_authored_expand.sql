CREATE FUNCTION docket_guard_schedule_conversion_retention () RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.conversion_receipt IS NULL OR NOT EXISTS(SELECT 1 FROM organization WHERE id=OLD.organization_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Prepared conversion revisions survive ordinary deletion' USING ERRCODE='23514',CONSTRAINT='schedule_conversion_retention';
END $$;

--> statement-breakpoint
CREATE TRIGGER schedule_conversion_retention_guard
BEFORE DELETE ON recurrence_series_revision FOR EACH ROW
EXECUTE FUNCTION docket_guard_schedule_conversion_retention ();

--> statement-breakpoint
ALTER TABLE work_template_invocation_revision
ALTER COLUMN original_source_fingerprint
DROP NOT NULL;

--> statement-breakpoint
ALTER TABLE work_template_invocation_revision
ALTER COLUMN source_archive_hash
DROP NOT NULL;

--> statement-breakpoint
ALTER TABLE work_template_invocation_revision
ADD COLUMN authored_payload_hash text;

--> statement-breakpoint
ALTER TABLE work_template_invocation_revision
DROP CONSTRAINT invocation_revision_shape;

--> statement-breakpoint
ALTER TABLE work_template_invocation_revision
ADD CONSTRAINT invocation_revision_shape CHECK (
  number > 0
  AND creation_mode IN ('all_at_once', 'when_ready')
  AND (
    (
      state = 'published'
      AND published_at IS NOT NULL
    )
    OR (
      state = 'pending_draft'
      AND published_at IS NULL
    )
  )
  AND (
    (
      origin = 'retained'
      AND original_source_fingerprint IS NOT NULL
      AND source_archive_hash IS NOT NULL
      AND original_source_fingerprint ~ '^[a-f0-9]{32}$'
      AND source_archive_hash ~ '^sha256:[a-f0-9]{64}$'
      AND authored_payload_hash IS NULL
    )
    OR (
      origin = 'authored'
      AND original_source_fingerprint IS NULL
      AND source_archive_hash IS NULL
      AND authored_payload_hash IS NOT NULL
      AND authored_payload_hash ~ '^sha256:[a-f0-9]{64}$'
    )
  )
);

--> statement-breakpoint
CREATE FUNCTION docket_private_definition_context (document jsonb, tenant text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE root jsonb; entry jsonb; field_name text; table_name text; reference_id text; present boolean; label_id text;
BEGIN
 FOR root IN SELECT value FROM jsonb_array_elements(document->'roots') LOOP
  IF root->'template'<>'null'::jsonb THEN PERFORM docket_validate_schedule_template(root->'template',tenant); END IF;
  FOR entry IN SELECT root->'root' UNION ALL SELECT value FROM jsonb_array_elements(root->'stepOverrides') LOOP
   IF entry='null'::jsonb THEN CONTINUE; END IF;
   FOR field_name,table_name IN SELECT refs.field_name,refs.table_name FROM (VALUES('teamId','team'),('responsibleActorId','actor'),('cycleId','cycle')) refs(field_name,table_name) LOOP
    reference_id:=entry->>field_name;
    IF reference_id IS NOT NULL THEN
      EXECUTE format('select exists(select 1 from %I where id=$1 and organization_id=$2)',table_name) INTO present USING reference_id,tenant;
      IF NOT present THEN RETURN false; END IF;
    END IF;
   END LOOP;
   FOR field_name,table_name IN SELECT refs.field_name,refs.table_name FROM (VALUES('programId','program'),('projectId','project'),('milestoneId','milestone'),('parentTaskId','task')) refs(field_name,table_name) LOOP
    reference_id:=entry->'placement'->>field_name;
    IF reference_id IS NOT NULL THEN
      EXECUTE format('select exists(select 1 from %I where id=$1 and organization_id=$2)',table_name) INTO present USING reference_id,tenant;
      IF NOT present THEN RETURN false; END IF;
    END IF;
   END LOOP;
   FOR label_id IN SELECT value FROM jsonb_array_elements_text(coalesce(entry->'fields'->'labelIds','[]'::jsonb)) LOOP
    IF NOT EXISTS(SELECT 1 FROM label WHERE id=label_id AND organization_id=tenant) THEN RETURN false; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 RETURN true;
 EXCEPTION WHEN others THEN RETURN false;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_private_definition_shape (document jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE root jsonb; entry jsonb; fields text[]; roots text[]; mapped jsonb; required_fields jsonb;
BEGIN
 IF NOT coalesce(docket_schedule_keys(document,ARRAY['kind','revision','state','creationMode','roots','sourceMappings','dependencies','timing','absentFields','titlePolicy','titles','completionPolicy','authoring'] || (CASE WHEN document ? 'placements' THEN ARRAY['placements'] ELSE ARRAY[]::text[] END))
   AND document->>'kind'='private_definition' AND document->'revision'='1'::jsonb AND document->>'state' IN('published','pending_draft') AND document->>'creationMode' IN('all_at_once','when_ready')
   AND docket_schedule_keys(document->'authoring',ARRAY['kind','revision','definitionAlias','revisionAlias','definition']) AND document->'authoring'->>'kind'='process_definition' AND document->'authoring'->'revision'='1'::jsonb
   AND length(document->'authoring'->>'definitionAlias')>0 AND length(document->'authoring'->>'revisionAlias')>0 AND jsonb_typeof(document->'authoring'->'definition')='object' AND jsonb_typeof(document->'roots')='array' AND jsonb_array_length(document->'roots')<=500
   AND jsonb_typeof(document->'sourceMappings')='array' AND jsonb_array_length(document->'sourceMappings')<=500
   AND jsonb_typeof(document->'dependencies')='array' AND jsonb_array_length(document->'dependencies')<=500
   AND document->'titlePolicy'=jsonb_build_object('kind','legacy_title','revision',1)
   AND docket_schedule_keys(document->'completionPolicy',ARRAY['kind','revision','tasks']) AND document->'completionPolicy'->>'kind'='legacy_authored_tasks' AND document->'completionPolicy'->'revision'='1'::jsonb
   AND jsonb_typeof(document->'completionPolicy'->'tasks')='array'
   AND docket_schedule_keys(document->'timing',ARRAY['kind','revision','rules']) AND document->'timing'->>'kind'='field_timing' AND document->'timing'->'revision'='2'::jsonb
   AND jsonb_typeof(document->'timing'->'rules')='array' AND jsonb_array_length(document->'timing'->'rules')<=1000
   AND jsonb_typeof(document->'absentFields')='array' AND jsonb_array_length(document->'absentFields')<=1000
   AND jsonb_typeof(document->'titles')='array' AND jsonb_array_length(document->'titles')<=500,false) THEN RETURN false; END IF;
 FOR root IN SELECT value FROM jsonb_array_elements(document->'roots') LOOP
  IF NOT coalesce(docket_schedule_keys(root,ARRAY['key','template','root','stepOverrides','optionalChoices']) AND root->>'key' ~ '^[a-z][a-z0-9_-]{0,63}$'
   AND jsonb_typeof(root->'stepOverrides')='array' AND jsonb_array_length(root->'stepOverrides')<=499
   AND jsonb_typeof(root->'optionalChoices')='array' AND jsonb_array_length(root->'optionalChoices')<=499
   AND (root->'root'='null'::jsonb OR root->'root'->>'kind' IN('task','project'))
   AND (root->'template'='null'::jsonb OR root->'template'->>'targetType' IN('task','project')),false) THEN RETURN false; END IF;
 END LOOP;
 IF document->>'state'='pending_draft' THEN RETURN true; END IF;
 IF jsonb_array_length(document->'roots')=0 THEN RETURN false; END IF;
 IF (SELECT count(*)<>count(DISTINCT value->'key') FROM jsonb_array_elements(document->'roots')) THEN RETURN false; END IF;
 FOR root IN SELECT value FROM jsonb_array_elements(document->'roots') LOOP
  IF NOT coalesce(docket_schedule_keys(root,ARRAY['key','template','root','stepOverrides','optionalChoices'])
   AND root->>'key' ~ '^[a-z][a-z0-9_-]{0,63}$' AND root->'root'->>'kind' IN('task','project')
   AND root->'template'->>'targetType'=root->'root'->>'kind' AND root->'template'->'selection'->>'kind'='pinned'
   AND jsonb_typeof(root->'stepOverrides')='array' AND jsonb_typeof(root->'optionalChoices')='array',false) THEN RETURN false; END IF;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(document->'sourceMappings') LOOP
  IF NOT coalesce(docket_schedule_keys(entry,ARRAY['alias','sourceKey','reference','kind','sort']) AND length(entry->>'alias')>0 AND jsonb_typeof(entry->'sourceKey')='string'
    AND entry->>'kind' IN('task','project','milestone') AND docket_schedule_v2_ref(entry->'reference',document)
    AND jsonb_typeof(entry->'sort')='number' AND (entry->>'sort')::integer>=0,false) THEN RETURN false; END IF;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT value->>'alias') OR count(*)<>count(DISTINCT value->>'sourceKey') OR count(*)<>count(DISTINCT value->'reference') FROM jsonb_array_elements(document->'sourceMappings')) THEN RETURN false; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(document->'timing'->'rules') LOOP
  IF NOT coalesce(docket_schedule_keys(entry,ARRAY['target','source','offset']) AND docket_schedule_v2_ref(entry->'target',document,true)
    AND docket_schedule_v2_source(entry->'source',document) AND docket_schedule_keys(entry->'offset',ARRAY['days','unit'])
    AND jsonb_typeof(entry->'offset'->'days')='number' AND (entry->'offset'->>'days')::integer BETWEEN -36500 AND 36500
    AND entry->'offset'->>'unit' IN('calendar','working'),false) THEN RETURN false; END IF;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(document->'absentFields') LOOP IF NOT docket_schedule_v2_ref(entry,document,true) THEN RETURN false; END IF; END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(document->'dependencies') LOOP
  IF NOT docket_schedule_keys(entry,ARRAY['blocker','blocked']) OR NOT docket_schedule_v2_ref(entry->'blocker',document) OR NOT docket_schedule_v2_ref(entry->'blocked',document) THEN RETURN false; END IF;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(document->'titles') LOOP
  IF NOT coalesce(docket_schedule_keys(entry,ARRAY['target','kind','pattern']) AND docket_schedule_v2_ref(entry->'target',document) AND jsonb_typeof(entry->'pattern')='string'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(document->'sourceMappings') m(value) WHERE m.value->'reference'=entry->'target' AND m.value->'kind'=entry->'kind'),false) THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_array_length(document->'titles')<>jsonb_array_length(document->'sourceMappings') OR (SELECT count(*)<>count(DISTINCT value->'target') FROM jsonb_array_elements(document->'titles')) THEN RETURN false; END IF;
 IF (SELECT coalesce(jsonb_agg(value->'reference' ORDER BY (value->'reference')::text),'[]'::jsonb) FROM jsonb_array_elements(document->'sourceMappings') WHERE value->>'kind'='task') IS DISTINCT FROM
   (SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM jsonb_array_elements(document->'completionPolicy'->'tasks')) THEN RETURN false; END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) INTO required_fields FROM (
  SELECT (mapping->'reference') || jsonb_build_object('field',field) AS value FROM jsonb_array_elements(document->'sourceMappings') mapping
    CROSS JOIN LATERAL unnest(CASE WHEN mapping->>'kind'='task' THEN ARRAY['startDate','dueDate'] WHEN mapping->>'kind'='project' THEN ARRAY['startDate','targetDate'] ELSE ARRAY['targetDate'] END) field
 ) expected;
 IF required_fields IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (
   SELECT value->'target' AS value FROM jsonb_array_elements(document->'timing'->'rules') UNION ALL SELECT value FROM jsonb_array_elements(document->'absentFields')) declared) THEN RETURN false; END IF;
 RETURN docket_private_root_placements(document);
 EXCEPTION WHEN others THEN RETURN false;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_authored_invocation_projection (document jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('revision',1,'steps',coalesce(jsonb_agg(jsonb_build_object('alias',value->'alias','key',value->'sourceKey','rootKey',value->'reference'->'rootKey','path',value->'reference'->'path','kind',value->'kind','sort',value->'sort') ORDER BY (value->>'sort')::integer,value->>'alias'),'[]'::jsonb)) FROM jsonb_array_elements(document->'sourceMappings')
$$;

--> statement-breakpoint
CREATE FUNCTION docket_private_root_placements (document jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
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
  SELECT entry->>'rootKey' AS target,parent.value->>'rootKey' AS source FROM jsonb_array_elements(document->'placements') entry
   CROSS JOIN LATERAL jsonb_each(entry-'rootKey') parent
 ), reach(target,source) AS (
  SELECT target,source FROM edges UNION SELECT reach.target,edges.source FROM reach JOIN edges ON edges.target=reach.source
 ) SELECT 1 FROM reach WHERE target=source);
 EXCEPTION WHEN others THEN RETURN false;
END $$;

--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX invocation_revision_invocation_tenant_unique ON work_template_invocation_revision (invocation_id, organization_id);

--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_blueprint_invocation_guard () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root jsonb; entry jsonb; payload jsonb:=NEW.manifest; context_row jsonb; field_name text; table_name text; reference_id text; present boolean;
BEGIN
  IF NEW.owner_actor_id IS NOT NULL AND NOT EXISTS(select 1 from actor where id=NEW.owner_actor_id and organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invocation owner is outside its workspace' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
  IF payload->>'kind'='private_definition' THEN
    IF NEW.overrides<>'[]'::jsonb OR NOT docket_private_definition_shape(payload) OR NOT docket_private_definition_context(payload,NEW.organization_id) THEN
      RAISE EXCEPTION 'Invalid private authored definition' USING ERRCODE='23514',CONSTRAINT='private_definition_shape';
    END IF;
    RETURN NEW;
  END IF;
  IF payload->>'kind'='forest' THEN
    IF NOT coalesce(docket_schedule_keys(payload,ARRAY['kind','revision','state','roots','dependencies','timing']) AND payload->>'revision'='1'
      AND payload->>'state' IN('published','pending_draft') AND jsonb_typeof(payload->'roots')='array'
      AND jsonb_array_length(payload->'roots') BETWEEN 1 AND 500 AND NEW.overrides='[]'::jsonb,false) THEN
      RAISE EXCEPTION 'Invalid native private forest' USING ERRCODE='23514',CONSTRAINT='schedule_forest_shape'; END IF;
    FOR root IN SELECT * FROM jsonb_array_elements(payload->'roots') LOOP
      PERFORM docket_validate_schedule_template(root->'draft'->'template',NEW.organization_id);
      IF NOT docket_schedule_keys(root,ARRAY['key','draft']) OR root->'draft'->>'kind'<>'schedule' OR root->'draft'->>'revision'<>'1'
        OR NOT EXISTS(SELECT 1 FROM template t WHERE t.id=root->'draft'->'template'->>'workTypeId' AND t.organization_id=NEW.organization_id AND t.target_type::text=root->'draft'->'template'->>'targetType') THEN
        RAISE EXCEPTION 'Native forest root is outside its workspace' USING ERRCODE='23514',CONSTRAINT='schedule_forest_root'; END IF;
    END LOOP;
    RETURN NEW;
  END IF;
  IF jsonb_typeof(payload)<>'object' OR NOT (payload ?& ARRAY['kind','legacyProcessRevisionId','roots','steps','dependencies']) OR (select count(*) from jsonb_object_keys(payload))<>5 OR coalesce(payload->>'kind','') NOT IN('published','pending_draft') OR jsonb_typeof(payload->'roots')<>'array' OR jsonb_typeof(payload->'steps')<>'array' OR jsonb_typeof(payload->'dependencies')<>'array' OR jsonb_typeof(NEW.overrides)<>'array' THEN RAISE EXCEPTION 'Malformed restricted blueprint invocation' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
  IF jsonb_array_length(payload->'steps')>500 OR jsonb_array_length(payload->'roots')>500 OR jsonb_array_length(payload->'dependencies')>2000 OR jsonb_array_length(NEW.overrides)>500 OR NOT EXISTS(select 1 from process_revision where id=payload->>'legacyProcessRevisionId' and organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invocation source or bounded graph is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
  IF (payload->>'kind'='published') IS DISTINCT FROM EXISTS(select 1 from process_revision r join process_definition d on d.id=r.definition_id and d.organization_id=r.organization_id where r.id=payload->>'legacyProcessRevisionId' and r.published_at is not null and d.status in('published','archived')) THEN RAISE EXCEPTION 'Invocation publication classification differs from retained source' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
  FOR root IN SELECT json_item.value FROM jsonb_array_elements(payload->'roots') AS json_item(value) LOOP
    IF NOT (root ?& ARRAY['sourceStepId','sourceKey','key','kind','workTypeId','workTypeVersionId']) OR (select count(*) from jsonb_object_keys(root))<>6 OR coalesce(root->>'key','') !~ '^[a-z][a-z0-9_-]{0,63}$' OR coalesce(root->>'kind','') NOT IN('project','task') OR ((root->>'workTypeId' IS NULL)<>(root->>'workTypeVersionId' IS NULL)) THEN RAISE EXCEPTION 'Invocation root selection is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
    IF payload->>'kind'='pending_draft' THEN
      IF root->>'workTypeId' IS NOT NULL THEN RAISE EXCEPTION 'Unpublished invocation cannot claim a publication' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
    ELSIF NOT EXISTS(select 1 from work_type_version v join template t on t.id=v.work_type_id and t.organization_id=v.organization_id where v.id=root->>'workTypeVersionId' and v.work_type_id=root->>'workTypeId' and v.organization_id=NEW.organization_id and t.target_type::text=root->>'kind' and t.scope='organization' and t.publication_state in('published','archived')) THEN RAISE EXCEPTION 'Invocation root publication belongs to another workspace or kind' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
  END LOOP;
  FOR entry IN SELECT json_item.value FROM jsonb_array_elements(payload->'steps') AS json_item(value) LOOP
    IF NOT (entry ?& ARRAY['sourceStepId','sourceKey','rootKey','path','blueprintStepId','sourceVersionId']) OR (select count(*) from jsonb_object_keys(entry))<>6 OR NOT EXISTS(select 1 from jsonb_array_elements(payload->'roots') AS invocation_root(value) where invocation_root.value->>'key'=entry->>'rootKey') OR ((entry->>'blueprintStepId' IS NULL)<>(entry->>'sourceVersionId' IS NULL)) OR jsonb_typeof(entry->'path')<>'array' OR jsonb_array_length(entry->'path')>499 OR NOT EXISTS(select 1 from process_step where id=entry->>'sourceStepId' and revision_id=payload->>'legacyProcessRevisionId' and organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invocation source step is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
    IF entry->>'blueprintStepId' IS NOT NULL AND NOT EXISTS(select 1 from blueprint_step where id=entry->>'blueprintStepId' and version_id=entry->>'sourceVersionId' and organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invocation projection is outside its workspace' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
  END LOOP;
  FOR context_row IN SELECT json_item.value FROM jsonb_array_elements(NEW.overrides) AS json_item(value) LOOP
    IF jsonb_typeof(context_row->'fields') IS DISTINCT FROM 'object' OR (context_row->'fields'->>'organization_id' IS NOT NULL AND context_row->'fields'->>'organization_id'<>NEW.organization_id) OR NOT EXISTS(select 1 from process_step where id=context_row->>'sourceStepId' and revision_id=payload->>'legacyProcessRevisionId' and organization_id=NEW.organization_id and kind::text=context_row->>'kind') THEN RAISE EXCEPTION 'Invocation override source is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
    FOR field_name,table_name IN SELECT refs.field_name,refs.table_name FROM (VALUES('team_id','team'),('lead_id','actor'),('assignee_id','actor'),('program_id','program'),('project_id','project'),('milestone_id','milestone'),('cycle_id','cycle'),('parent_task_id','task'),('work_type_id','template')) refs(field_name,table_name) LOOP
      reference_id:=context_row->'fields'->>field_name;
      IF reference_id IS NOT NULL THEN
        EXECUTE format('select exists(select 1 from %I where id=$1 and organization_id=$2)',table_name) INTO present USING reference_id,NEW.organization_id;
        IF NOT present THEN RAISE EXCEPTION 'Invocation override reference is outside its workspace' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
      END IF;
    END LOOP;
    IF context_row->'fields'->>'work_type_version_id' IS NOT NULL AND NOT EXISTS(select 1 from work_type_version v where v.id=context_row->'fields'->>'work_type_version_id' and v.work_type_id=context_row->'fields'->>'work_type_id' and v.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invocation override version belongs to another template' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
  END LOOP;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_guard_invocation_revision () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE private_owner text; head_owner text; next_number integer; c work_template_blueprint_conversion; document jsonb; audit jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN
   IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organization WHERE id=OLD.organization_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'Private invocation revision is immutable' USING ERRCODE='23514',CONSTRAINT='invocation_revision_immutable';
 END IF;
 IF NEW.origin='authored' THEN
   SELECT manifest,owner_actor_id INTO document,private_owner FROM work_template_blueprint_invocation WHERE id=NEW.invocation_id AND organization_id=NEW.organization_id;
   SELECT owner_actor_id INTO head_owner FROM work_template_invocation_head WHERE id=NEW.head_id AND organization_id=NEW.organization_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Authored revision requires its current private head' USING ERRCODE='23514',CONSTRAINT='invocation_authored_proof'; END IF;
   SELECT coalesce(max(number),0)+1 INTO next_number FROM work_template_invocation_revision WHERE head_id=NEW.head_id AND organization_id=NEW.organization_id;
   IF NOT coalesce(NEW.original_source_fingerprint IS NULL AND NEW.source_archive_hash IS NULL
     AND NEW.authored_payload_hash=docket_schedule_fingerprint(document)
     AND docket_private_definition_shape(document) AND docket_private_definition_context(document,NEW.organization_id)
     AND document->'authoring'->>'definitionAlias'=NEW.head_id AND document->'authoring'->>'revisionAlias'=NEW.id
     AND NEW.state=document->>'state' AND NEW.creation_mode=document->>'creationMode' AND NEW.number=next_number
     AND NEW.projection=docket_authored_invocation_projection(document)
     AND private_owner IS NOT DISTINCT FROM head_owner
     AND (NEW.created_by IS NULL OR EXISTS(SELECT 1 FROM actor WHERE id=NEW.created_by AND organization_id=NEW.organization_id)),false) THEN
     RAISE EXCEPTION 'Authored revision requires exact private payload and aliases' USING ERRCODE='23514',CONSTRAINT='invocation_authored_proof';
   END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO c FROM work_template_blueprint_conversion WHERE legacy_process_revision_id=NEW.id AND organization_id=NEW.organization_id AND invocation_id=NEW.invocation_id;
 SELECT manifest INTO document FROM work_template_blueprint_invocation WHERE id=NEW.invocation_id AND organization_id=NEW.organization_id;
 audit:=c.source_archive->'revisionAudit';
 IF c.source_archive IS NULL OR document IS NULL OR NOT coalesce(
   c.source_archive_hash=docket_schedule_fingerprint(c.source_archive)
   AND md5((c.source_archive->'source')::text)=c.source_fingerprint
   AND NEW.original_source_fingerprint=c.source_fingerprint AND NEW.source_archive_hash=c.source_archive_hash
   AND NEW.head_id=c.source_archive->'source'->'revision'->>'definition_id'
   AND NEW.id=document->>'legacyProcessRevisionId' AND NEW.state=document->>'kind'
   AND NEW.number=(c.source_archive->'source'->'revision'->>'number')::integer
   AND NEW.creation_mode=c.source_archive->'source'->'revision'->>'creation_mode'
   AND NEW.projection=docket_invocation_revision_projection(c.source_archive,document)
   AND jsonb_array_length(NEW.projection->'steps')=jsonb_array_length(c.source_archive->'source'->'steps')
   AND NEW.created_by IS NOT DISTINCT FROM (audit->>'created_by')
   AND NEW.created_at IS NOT DISTINCT FROM ((audit->>'created_at')::timestamp at time zone 'UTC')
   AND NEW.published_at IS NOT DISTINCT FROM ((audit->>'published_at')::timestamp at time zone 'UTC'),false) THEN
   RAISE EXCEPTION 'Private revision requires exact original archive proof' USING ERRCODE='23514',CONSTRAINT='invocation_revision_proof';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_validate_invocation_head () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE publication jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Private invocation identity is immutable' USING ERRCODE='23514', CONSTRAINT='invocation_head_identity';
    END IF;
    -- Referential actor deletion may clear nullable attribution without a caller CAS.
    -- It cannot change authoring fields or pointers, and still advances the revision.
    IF NEW.revision = OLD.revision
      AND (to_jsonb(NEW) - ARRAY['owner_actor_id','created_by']) = (to_jsonb(OLD) - ARRAY['owner_actor_id','created_by'])
      AND (NEW.owner_actor_id IS NOT DISTINCT FROM OLD.owner_actor_id OR NEW.owner_actor_id IS NULL)
      AND (NEW.created_by IS NOT DISTINCT FROM OLD.created_by OR NEW.created_by IS NULL)
      AND ((OLD.owner_actor_id IS NOT NULL AND NEW.owner_actor_id IS NULL AND NOT EXISTS(SELECT 1 FROM actor WHERE id=OLD.owner_actor_id))
        OR (OLD.created_by IS NOT NULL AND NEW.created_by IS NULL AND NOT EXISTS(SELECT 1 FROM actor WHERE id=OLD.created_by))) THEN
      NEW.revision := OLD.revision + 1;
    END IF;
    IF NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'Private invocation edit requires the next revision' USING ERRCODE='23514', CONSTRAINT='invocation_head_revision_cas';
    END IF;
  ELSIF NEW.revision <> 1 THEN
    RAISE EXCEPTION 'Private invocation head starts at revision one' USING ERRCODE='23514', CONSTRAINT='invocation_head_revision_cas';
  END IF;
  IF NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM actor WHERE id=NEW.created_by AND organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'Private invocation creator belongs to another workspace' USING ERRCODE='23514', CONSTRAINT='invocation_head_creator_tenant';
  END IF;
  IF NEW.published_invocation_id IS NOT NULL THEN
    SELECT manifest INTO publication FROM work_template_blueprint_invocation
      WHERE id=NEW.published_invocation_id AND organization_id=NEW.organization_id;
    IF publication IS NULL OR NOT coalesce((publication->>'kind'='published'
      OR (publication->>'kind'='forest' AND publication->>'revision'='1' AND publication->>'state'='published')
      OR (publication->>'kind'='private_definition' AND publication->>'state'='published' AND docket_private_definition_shape(publication))), false) THEN
      RAISE EXCEPTION 'Published head requires an executable immutable document' USING ERRCODE='23514', CONSTRAINT='invocation_head_publication';
    END IF;
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_guard_canonical_invocation_head () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source process_definition;
BEGIN
 IF TG_OP='UPDATE' AND OLD.canonical_authoring_at IS NOT NULL AND NEW.canonical_authoring_at IS DISTINCT FROM OLD.canonical_authoring_at THEN
   RAISE EXCEPTION 'Canonical authoring ownership is immutable' USING ERRCODE='23514',CONSTRAINT='invocation_head_authoring_owner';
 END IF;
 IF NEW.canonical_authoring_at IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR OLD.canonical_authoring_at IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM process_definition WHERE id=NEW.id AND organization_id=NEW.organization_id) THEN
     IF NOT EXISTS(SELECT 1 FROM work_template_invocation_revision WHERE head_id=NEW.id AND organization_id=NEW.organization_id AND origin='authored')
       OR EXISTS(SELECT 1 FROM work_template_invocation_revision WHERE head_id=NEW.id AND organization_id=NEW.organization_id AND origin<>'authored') THEN
       RAISE EXCEPTION 'Fresh private ownership requires authored canonical history' USING ERRCODE='23514',CONSTRAINT='invocation_head_authoring_registration';
     END IF;
   ELSE
   SELECT * INTO source FROM process_definition WHERE id=NEW.id AND organization_id=NEW.organization_id FOR UPDATE;
   IF source.id IS NULL OR ROW(NEW.name,NEW.description,NEW.status,NEW.archived_at) IS DISTINCT FROM ROW(source.name,source.description,source.status::text,source.archived_at)
    OR NOT EXISTS(SELECT 1 FROM process_revision WHERE definition_id=NEW.id AND organization_id=NEW.organization_id)
    OR EXISTS(SELECT 1 FROM process_revision r WHERE r.definition_id=NEW.id AND r.organization_id=NEW.organization_id AND NOT EXISTS(SELECT 1 FROM work_template_invocation_revision v WHERE v.id=r.id AND v.head_id=NEW.id AND v.organization_id=NEW.organization_id)) THEN
     RAISE EXCEPTION 'Canonical ownership requires complete registered history and current metadata' USING ERRCODE='23514',CONSTRAINT='invocation_head_authoring_registration';
   END IF;
   END IF;
 END IF;
 IF NEW.draft_invocation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM work_template_invocation_revision WHERE invocation_id=NEW.draft_invocation_id AND head_id=NEW.id AND organization_id=NEW.organization_id) THEN
   RAISE EXCEPTION 'Draft pointer requires this head revision' USING ERRCODE='23514',CONSTRAINT='invocation_head_draft_revision';
 END IF;
 IF NEW.published_invocation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM work_template_invocation_revision WHERE invocation_id=NEW.published_invocation_id AND head_id=NEW.id AND organization_id=NEW.organization_id AND state='published') THEN
   RAISE EXCEPTION 'Publication pointer requires this head publication' USING ERRCODE='23514',CONSTRAINT='invocation_head_published_revision';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_schedule_v2_shape (document jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE root jsonb; rule jsonb; entry jsonb;
BEGIN
 IF NOT coalesce(docket_schedule_keys(document,ARRAY['kind','revision','state','creationMode','roots','dependencies','timing','absentFields','titlePolicy','titles','completionPolicy'] || (CASE WHEN document ? 'placements' THEN ARRAY['placements'] ELSE ARRAY[]::text[] END))
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
CREATE FUNCTION docket_schedule_qualified_actual (roots jsonb, reference jsonb, expected_kind text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE root_entry jsonb; selected_entry jsonb;
BEGIN
 SELECT value INTO root_entry FROM jsonb_array_elements(roots) WHERE value->>'key'=reference->>'rootKey';
 IF reference->'path'='[]'::jsonb THEN RETURN CASE WHEN root_entry->>'kind'=expected_kind THEN root_entry->>'id' ELSE NULL END; END IF;
 SELECT value INTO selected_entry FROM jsonb_array_elements(root_entry->'selectedWork') WHERE value->'path'=reference->'path' AND value->>'kind'=expected_kind;
 RETURN selected_entry->>'id';
 EXCEPTION WHEN others THEN RETURN NULL;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_guard_schedule_root_placements () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; entry jsonb; root_id text; actual_row task; parent_id text;
BEGIN
 IF NEW.accepted_claim IS NULL OR NEW.blueprint_applied_at IS NULL THEN RETURN NEW; END IF;
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

--> statement-breakpoint
CREATE TRIGGER schedule_root_placement_actual_guard
BEFORE INSERT OR UPDATE ON process_occurrence FOR EACH ROW
EXECUTE FUNCTION docket_guard_schedule_root_placements ();
