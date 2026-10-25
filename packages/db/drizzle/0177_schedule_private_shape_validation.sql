-- Placement validation applies before either V2 completion-policy return.
CREATE OR REPLACE FUNCTION docket_schedule_v2_shape (document jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE root jsonb; rule jsonb; entry jsonb;
BEGIN
 IF NOT docket_private_root_placements(document) THEN RETURN false; END IF;
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
-- Private authored completion offsets share the runtime nonnegative contract.
CREATE OR REPLACE FUNCTION docket_private_definition_shape (document jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
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
    AND entry->'offset'->>'unit' IN('calendar','working')
    AND (entry->'source'->>'kind'<>'after_completion' OR (entry->'offset'->>'days')::integer>=0),false) THEN RETURN false; END IF;
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
