-- Complete retained sources must have matching committed receipts before this journal advances.
DO $$ BEGIN
  IF EXISTS(select 1 from process_revision r left join work_template_blueprint_conversion c on c.legacy_process_revision_id=r.id and c.organization_id=r.organization_id where c.legacy_process_revision_id is null or c.source_fingerprint<>docket_blueprint_source_fingerprint(r.id)) THEN
    RAISE EXCEPTION 'Blueprint conversion is incomplete or stale; quiesce definition/scheduler writers and resume the checkpoint' USING ERRCODE='23514',CONSTRAINT='blueprint_checkpoint_complete';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_date_rule_valid(rule jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry jsonb;
BEGIN
  IF jsonb_typeof(rule)<>'object' THEN RETURN false; END IF;
  IF rule->>'kind'='none' THEN RETURN rule='{"kind":"none"}'::jsonb; END IF;
  IF coalesce(rule->>'kind','') NOT IN('anchor','after_completion') OR jsonb_typeof(rule->'offset')<>'object' OR coalesce(rule->'offset'->>'unit','') NOT IN('calendar','working') OR coalesce(rule->'offset'->>'days','') !~ '^-?[0-9]+$' THEN RETURN false; END IF;
  IF abs((rule->'offset'->>'days')::numeric)>36500 OR (select count(*) from jsonb_object_keys(rule->'offset'))<>2 THEN RETURN false; END IF;
  IF rule->>'kind'='anchor' THEN
    IF jsonb_typeof(rule->'anchor')<>'object' OR coalesce(rule->'anchor'->>'kind','') NOT IN('parent','milestone') THEN RETURN false; END IF;
    IF rule->'anchor'->>'kind'='parent' AND rule->'anchor'<>'{"kind":"parent"}'::jsonb THEN RETURN false; END IF;
    IF rule->'anchor'->>'kind'='milestone' AND (coalesce(rule->'anchor'->>'stepKey','') !~ '^[a-z][a-z0-9_-]{0,63}$' OR (select count(*) from jsonb_object_keys(rule->'anchor'))<>2) THEN RETURN false; END IF;
  ELSE
    IF (rule->'offset'->>'days')::numeric<0 OR jsonb_typeof(rule->'stepKeys')<>'array' OR jsonb_array_length(rule->'stepKeys') NOT BETWEEN 1 AND 499 THEN RETURN false; END IF;
    IF EXISTS(select 1 from jsonb_array_elements(rule->'stepKeys') AS rule_key(value) where jsonb_typeof(rule_key.value)<>'string' or trim(both '"' from rule_key.value::text) !~ '^[a-z][a-z0-9_-]{0,63}$') OR (select count(distinct rule_key.value) from jsonb_array_elements(rule->'stepKeys') AS rule_key(value))<>jsonb_array_length(rule->'stepKeys') THEN RETURN false; END IF;
  END IF;
  IF EXISTS(select 1 from jsonb_object_keys(rule) AS rule_member(key) where rule_member.key NOT IN('kind','anchor','offset','stepKeys','snap')) OR (rule->>'kind'='anchor' AND rule ? 'stepKeys') OR (rule->>'kind'='after_completion' AND rule ? 'anchor') THEN RETURN false; END IF;
  IF rule ? 'snap' THEN
    entry:=rule->'snap';
    IF jsonb_typeof(entry)<>'object' OR coalesce(entry->>'direction','') NOT IN('next','previous') OR coalesce(entry->>'weekday','') !~ '^[1-7]$' OR jsonb_typeof(entry->'inclusive')<>'boolean' OR (select count(*) from jsonb_object_keys(entry))<>3 THEN RETURN false; END IF;
  END IF;
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_step_shape(item jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE allowed text[]; field text; field_value jsonb;
BEGIN
  IF jsonb_typeof(item)<>'object' OR NOT (item ?& ARRAY['key','kind','parentStepKey','sort','optional','template','teamRule','actorRule','fields','dates']) OR (select count(*) from jsonb_object_keys(item))<>(CASE WHEN item->>'kind'='task' THEN 11 ELSE 10 END) THEN RETURN false; END IF;
  IF coalesce(item->>'key','') !~ '^[a-z][a-z0-9_-]{0,63}$' OR (item->'parentStepKey'<>'null'::jsonb AND coalesce(item->>'parentStepKey','') !~ '^[a-z][a-z0-9_-]{0,63}$') OR coalesce(item->>'sort','') !~ '^[0-9]+$' OR coalesce(item->>'teamRule','') NOT IN('parent_team','creation_team','none') OR coalesce(item->>'actorRule','') NOT IN('parent_responsible','creator','athena','unassigned') THEN RETURN false; END IF;
  IF jsonb_typeof(item->'optional')<>'object' OR NOT (item->'optional' ?& ARRAY['enabled','selectedByDefault']) OR (select count(*) from jsonb_object_keys(item->'optional'))<>2 OR jsonb_typeof(item->'optional'->'enabled')<>'boolean' OR jsonb_typeof(item->'optional'->'selectedByDefault')<>'boolean' OR (item->'optional'->'enabled'='false'::jsonb AND item->'optional'->'selectedByDefault'<>'true'::jsonb) THEN RETURN false; END IF;
  IF item->>'kind'='task' AND coalesce(item->>'cycleRule','') NOT IN('none','parent_cycle','current_cycle') THEN RETURN false; END IF;
  IF jsonb_typeof(item->'fields')<>'object' OR jsonb_typeof(item->'dates')<>'object' THEN RETURN false; END IF;
  allowed:=CASE item->>'kind' WHEN 'task' THEN ARRAY['title','summary','description','priority','state','labelIds','estimate','estimateMinutes'] WHEN 'project' THEN ARRAY['name','summary','description','status','health','priority'] WHEN 'program' THEN ARRAY['name','summary','description','status','health','visibility'] WHEN 'milestone' THEN ARRAY['name','description'] ELSE ARRAY[]::text[] END;
  IF cardinality(allowed)=0 OR coalesce(length(btrim(item->'fields'->>(CASE WHEN item->>'kind'='task' THEN 'title' ELSE 'name' END))),0)=0 THEN RETURN false; END IF;
  FOR field,field_value IN SELECT field_member.key,field_member.value FROM jsonb_each(item->'fields') AS field_member LOOP
    IF NOT field=ANY(allowed) THEN RETURN false; END IF;
    IF field='estimateMinutes' AND field_value='null'::jsonb THEN CONTINUE;
    ELSIF field IN('estimate','estimateMinutes') THEN IF field_value::text !~ '^[0-9]+$' OR field_value::numeric>9007199254740991 THEN RETURN false; END IF;
    ELSIF field='labelIds' THEN IF jsonb_typeof(field_value)<>'array' OR EXISTS(select 1 from jsonb_array_elements(field_value) AS label_id(value) where jsonb_typeof(label_id.value)<>'string') THEN RETURN false; END IF;
    ELSIF jsonb_typeof(field_value)<>'string' THEN RETURN false;
    END IF;
    IF field IN('state','status') AND length(item->'fields'->>field)=0 THEN RETURN false; END IF;
    IF field='summary' AND length(item->'fields'->>field)>(CASE WHEN item->>'kind'='task' THEN 200 ELSE 280 END) THEN RETURN false; END IF;
    IF field='priority' AND item->'fields'->>field NOT IN('none','urgent','high','medium','low') THEN RETURN false; END IF;
    IF field='health' AND item->'fields'->>field NOT IN('on_track','at_risk','off_track') THEN RETURN false; END IF;
    IF field='visibility' AND item->'fields'->>field NOT IN('public','private') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_assert_acyclic(edges jsonb,constraint_key text DEFAULT 'blueprint_dependency') RETURNS void LANGUAGE plpgsql AS $$
DECLARE adjacency jsonb:='{}'::jsonb; degrees jsonb:='{}'::jsonb; edge jsonb; source text; target text; queue text[]; cursor_index integer:=1; visited integer:=0; degree integer;
BEGIN
  FOR edge IN SELECT json_item.value FROM jsonb_array_elements(edges) AS json_item(value) LOOP
    source:=edge->>0; target:=edge->>1;
    adjacency:=jsonb_set(adjacency,ARRAY[source],coalesce(adjacency->source,'[]'::jsonb)||jsonb_build_array(target));
    degrees:=jsonb_set(degrees,ARRAY[target],to_jsonb(coalesce((degrees->>target)::integer,0)+1));
    IF NOT degrees ? source THEN degrees:=jsonb_set(degrees,ARRAY[source],'0'::jsonb); END IF;
  END LOOP;
  SELECT array_agg(degree_member.key) INTO queue FROM jsonb_each(degrees) AS degree_member WHERE degree_member.value='0'::jsonb;
  WHILE cursor_index<=coalesce(cardinality(queue),0) LOOP
    source:=queue[cursor_index];cursor_index:=cursor_index+1;visited:=visited+1;
    FOR target IN SELECT jsonb_array_elements_text(coalesce(adjacency->source,'[]'::jsonb)) LOOP
      degree:=(degrees->>target)::integer-1;
      degrees:=jsonb_set(degrees,ARRAY[target],to_jsonb(degree));
      IF degree=0 THEN queue:=array_append(queue,target); END IF;
    END LOOP;
  END LOOP;
  IF visited<>(select count(*) from jsonb_object_keys(degrees)) THEN RAISE EXCEPTION 'Blueprint graph contains a cycle' USING ERRCODE='23514',CONSTRAINT=constraint_key; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_assert_blueprint_projection(version_key text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE publication work_type_version%ROWTYPE; graph jsonb; wanted jsonb; actual jsonb; item jsonb; parent_kind text; child template%ROWTYPE; edge jsonb; date_value jsonb; target_key text;
BEGIN
  SELECT version_row.* INTO publication FROM work_type_version AS version_row WHERE version_row.id=version_key;
  IF NOT FOUND THEN RETURN; END IF;
  graph:=coalesce(publication.definition->'blueprint','{"steps":[],"dependencies":[]}'::jsonb);
  IF jsonb_typeof(graph)<>'object' OR jsonb_typeof(graph->'steps')<>'array' OR jsonb_typeof(graph->'dependencies')<>'array' THEN RAISE EXCEPTION 'Malformed published blueprint' USING ERRCODE='23514',CONSTRAINT='blueprint_projection'; END IF;
  IF jsonb_array_length(graph->'steps')>499 OR jsonb_array_length(graph->'dependencies')>2000 THEN RAISE EXCEPTION 'Published blueprint exceeds bounded graph limit' USING ERRCODE='23514',CONSTRAINT='blueprint_projection'; END IF;
  SELECT coalesce(jsonb_agg(authored_step.value ORDER BY authored_step.value->>'key'),'[]'::jsonb) INTO wanted FROM jsonb_array_elements(graph->'steps') AS authored_step(value);
  SELECT coalesce(jsonb_agg(step_row.step ORDER BY step_row.key),'[]'::jsonb) INTO actual FROM blueprint_step AS step_row WHERE step_row.version_id=version_key AND step_row.organization_id=publication.organization_id;
  IF wanted<>actual OR EXISTS(select 1 from blueprint_step s where s.version_id=version_key and (s.step->>'key' IS DISTINCT FROM s.key or s.step->>'kind' IS DISTINCT FROM s.kind or s.step->>'parentStepKey' IS DISTINCT FROM s.parent_step_key or s.step->>'sort' IS DISTINCT FROM s.sort::text)) THEN RAISE EXCEPTION 'Blueprint projection differs from immutable publication' USING ERRCODE='23514',CONSTRAINT='blueprint_projection'; END IF;
  FOR item IN SELECT json_item.value FROM jsonb_array_elements(graph->'steps') AS json_item(value) LOOP
    IF NOT docket_blueprint_step_shape(item) THEN RAISE EXCEPTION 'Malformed published blueprint step' USING ERRCODE='23514',CONSTRAINT='blueprint_fields'; END IF;
    IF item->>'parentStepKey' IS NULL THEN parent_kind:=publication.definition->'payload'->>'targetType';
    ELSE SELECT step_row.kind INTO parent_kind FROM blueprint_step AS step_row WHERE step_row.version_id=version_key AND step_row.key=item->>'parentStepKey'; END IF;
    IF parent_kind IS NULL OR NOT ((parent_kind='initiative' AND item->>'kind' IN('program','project')) OR (parent_kind='program' AND item->>'kind' IN('project','task')) OR (parent_kind='project' AND item->>'kind' IN('milestone','task')) OR (parent_kind IN('milestone','task') AND item->>'kind'='task')) THEN RAISE EXCEPTION 'Blueprint parent kind is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_hierarchy'; END IF;
    IF item->'template' IS DISTINCT FROM 'null'::jsonb THEN
      SELECT definition_row.* INTO child FROM template AS definition_row WHERE definition_row.id=item->'template'->>'workTypeId' AND definition_row.organization_id=publication.organization_id AND definition_row.scope='organization' AND definition_row.publication_state IN('published','archived') AND definition_row.target_type::text=item->>'kind';
      IF NOT FOUND OR item->>'kind'='milestone' OR coalesce(item->'template'->'selection'->>'kind','') NOT IN('latest','pinned') THEN RAISE EXCEPTION 'Blueprint child template has wrong workspace or kind' USING ERRCODE='23514',CONSTRAINT='blueprint_child_template'; END IF;
      IF item->'template'->'selection'->>'kind'='pinned' AND NOT EXISTS(select 1 from work_type_version AS version_row where version_row.id=item->'template'->'selection'->>'workTypeVersionId' and version_row.work_type_id=child.id and version_row.organization_id=publication.organization_id) THEN RAISE EXCEPTION 'Blueprint pin belongs to another template' USING ERRCODE='23514',CONSTRAINT='blueprint_child_template'; END IF;
    END IF;
    FOR target_key,date_value IN SELECT date_member.key,date_member.value FROM jsonb_each(item->'dates') AS date_member LOOP
      IF NOT ((item->>'kind'='task' AND target_key IN('startDate','dueDate')) OR (item->>'kind'='project' AND target_key IN('startDate','targetDate')) OR (item->>'kind'='milestone' AND target_key='targetDate')) OR NOT docket_blueprint_date_rule_valid(date_value) THEN RAISE EXCEPTION 'Blueprint date rule is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_date_rule'; END IF;
      IF date_value->>'kind'='anchor' AND date_value->'anchor'->>'kind'='milestone' AND NOT EXISTS(select 1 from blueprint_step s where s.version_id=version_key and s.key=date_value->'anchor'->>'stepKey' and s.kind='milestone' and s.parent_step_key IS NOT DISTINCT FROM item->>'parentStepKey') THEN RAISE EXCEPTION 'Blueprint Milestone anchor is outside its sibling scope' USING ERRCODE='23514',CONSTRAINT='blueprint_date_rule'; END IF;
      IF date_value->>'kind'='after_completion' AND EXISTS(select 1 from jsonb_array_elements_text(date_value->'stepKeys') AS prerequisite(value) where NOT EXISTS(select 1 from blueprint_step s where s.version_id=version_key and s.key=prerequisite.value and s.kind='task' and s.key<>item->>'key' and s.parent_step_key IS NOT DISTINCT FROM item->>'parentStepKey')) THEN RAISE EXCEPTION 'Blueprint completion prerequisite is outside its sibling scope' USING ERRCODE='23514',CONSTRAINT='blueprint_date_rule'; END IF;
    END LOOP;
  END LOOP;
  SELECT coalesce(jsonb_agg(authored_edge.value ORDER BY authored_edge.value->>'blockerStepKey',authored_edge.value->>'blockedStepKey'),'[]'::jsonb) INTO wanted FROM jsonb_array_elements(graph->'dependencies') AS authored_edge(value);
  SELECT coalesce(jsonb_agg(jsonb_build_object('blockerStepKey',a.key,'blockedStepKey',b.key) ORDER BY a.key,b.key),'[]'::jsonb) INTO actual FROM blueprint_dependency d JOIN blueprint_step a ON a.id=d.blocker_step_id JOIN blueprint_step b ON b.id=d.blocked_step_id WHERE d.version_id=version_key;
  IF wanted<>actual OR EXISTS(select 1 from blueprint_dependency d join blueprint_step a on a.id=d.blocker_step_id join blueprint_step b on b.id=d.blocked_step_id where d.version_id=version_key and (a.kind<>'task' or b.kind<>'task' or a.parent_step_key IS DISTINCT FROM b.parent_step_key)) THEN RAISE EXCEPTION 'Blueprint dependency projection is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_dependency'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_array(step_row.parent_step_key,step_row.key)),'[]'::jsonb) INTO actual FROM blueprint_step AS step_row WHERE step_row.version_id=version_key AND step_row.parent_step_key IS NOT NULL;
  PERFORM docket_blueprint_assert_acyclic(actual,'blueprint_hierarchy');
  SELECT coalesce(jsonb_agg(jsonb_build_array(edges.a,edges.b)),'[]'::jsonb) INTO actual FROM (
    SELECT blocker.key AS a,blocked.key AS b FROM blueprint_dependency d JOIN blueprint_step blocker ON blocker.id=d.blocker_step_id JOIN blueprint_step blocked ON blocked.id=d.blocked_step_id WHERE d.version_id=version_key
    UNION ALL SELECT prerequisite.value,s.key FROM blueprint_step s CROSS JOIN LATERAL jsonb_each(s.step->'dates') date_rule CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN date_rule.value->>'kind'='after_completion' THEN date_rule.value->'stepKeys' ELSE '[]'::jsonb END) AS prerequisite(value) WHERE s.version_id=version_key
  ) edges;
  PERFORM docket_blueprint_assert_acyclic(actual);

END $$;
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM docket_assert_blueprint_projection(CASE WHEN TG_TABLE_NAME='work_type_version' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'version_id' END);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER blueprint_version_projection AFTER INSERT ON work_type_version DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION docket_blueprint_projection_guard();
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_step_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(select 1 from work_type_version v cross join lateral jsonb_array_elements(coalesce(v.definition->'blueprint'->'steps','[]'::jsonb)) AS authored_step(value) where v.id=NEW.version_id and v.organization_id=NEW.organization_id and authored_step.value=NEW.step and authored_step.value->>'key'=NEW.key and authored_step.value->>'kind'=NEW.kind and authored_step.value->>'parentStepKey' IS NOT DISTINCT FROM NEW.parent_step_key and authored_step.value->>'sort'=NEW.sort::text) THEN RAISE EXCEPTION 'Independent blueprint step differs from immutable publication' USING ERRCODE='23514',CONSTRAINT='blueprint_projection'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER blueprint_step_projection BEFORE INSERT ON blueprint_step FOR EACH ROW EXECUTE FUNCTION docket_blueprint_step_insert_guard();
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_dependency_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(select 1 from work_type_version v join blueprint_step a on a.id=NEW.blocker_step_id and a.version_id=v.id and a.organization_id=v.organization_id join blueprint_step b on b.id=NEW.blocked_step_id and b.version_id=v.id and b.organization_id=v.organization_id cross join lateral jsonb_array_elements(coalesce(v.definition->'blueprint'->'dependencies','[]'::jsonb)) AS authored_edge(value) where v.id=NEW.version_id and v.organization_id=NEW.organization_id and authored_edge.value=jsonb_build_object('blockerStepKey',a.key,'blockedStepKey',b.key)) THEN RAISE EXCEPTION 'Independent blueprint edge differs from immutable publication' USING ERRCODE='23514',CONSTRAINT='blueprint_dependency'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER blueprint_dependency_projection BEFORE INSERT ON blueprint_dependency FOR EACH ROW EXECUTE FUNCTION docket_blueprint_dependency_insert_guard();
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(select 1 from organization where id=OLD.organization_id) THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='work_template_blueprint_invocation' AND to_jsonb(NEW)->>'owner_actor_id' IS NULL AND (to_jsonb(NEW)-'owner_actor_id')=(to_jsonb(OLD)-'owner_actor_id') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Published blueprint projections and invocation receipts are immutable' USING ERRCODE='23514',CONSTRAINT='blueprint_immutable';
END $$;
--> statement-breakpoint
CREATE TRIGGER blueprint_step_immutable BEFORE UPDATE OR DELETE ON blueprint_step FOR EACH ROW EXECUTE FUNCTION docket_blueprint_immutable();
--> statement-breakpoint
CREATE TRIGGER blueprint_dependency_immutable BEFORE UPDATE OR DELETE ON blueprint_dependency FOR EACH ROW EXECUTE FUNCTION docket_blueprint_immutable();
--> statement-breakpoint
CREATE TRIGGER blueprint_invocation_immutable BEFORE UPDATE OR DELETE ON work_template_blueprint_invocation FOR EACH ROW EXECUTE FUNCTION docket_blueprint_immutable();
--> statement-breakpoint
CREATE TRIGGER blueprint_conversion_immutable BEFORE UPDATE OR DELETE ON work_template_blueprint_conversion FOR EACH ROW EXECUTE FUNCTION docket_blueprint_immutable();
--> statement-breakpoint
CREATE FUNCTION docket_validate_blueprint_binding(bindings jsonb,work_kind text,tenant text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE field text; binding jsonb; source blueprint_step%ROWTYPE; civil text;
BEGIN
  IF jsonb_typeof(bindings)<>'object' THEN RAISE EXCEPTION 'Blueprint date bindings must be an object' USING ERRCODE='23514',CONSTRAINT='blueprint_date_binding'; END IF;
  FOR field,binding IN SELECT binding_member.key,binding_member.value FROM jsonb_each(bindings) AS binding_member LOOP
    IF NOT ((work_kind='task' AND field IN('startDate','dueDate')) OR (work_kind='project' AND field IN('startDate','targetDate')) OR (work_kind IN('initiative','milestone') AND field='targetDate')) OR jsonb_typeof(binding)<>'object' THEN RAISE EXCEPTION 'Unsupported blueprint date field' USING ERRCODE='23514',CONSTRAINT='blueprint_date_binding'; END IF;
    IF (select count(*) from jsonb_object_keys(binding))<>5 OR NOT (binding ?& ARRAY['sourceStepId','sourceVersionId','rule','manual','lastDerivedDate']) OR jsonb_typeof(binding->'manual')<>'boolean' OR NOT docket_blueprint_date_rule_valid(binding->'rule') THEN RAISE EXCEPTION 'Malformed blueprint date binding' USING ERRCODE='23514',CONSTRAINT='blueprint_date_binding'; END IF;
    SELECT step_row.* INTO source FROM blueprint_step AS step_row WHERE step_row.id=binding->>'sourceStepId' AND step_row.version_id=binding->>'sourceVersionId' AND step_row.organization_id=tenant AND step_row.kind=work_kind;
    IF NOT FOUND OR (source.step->'dates'->field IS DISTINCT FROM binding->'rule' AND NOT (source.step->'dates'->field IS NULL AND binding->'rule'='{"kind":"none"}'::jsonb AND binding->'manual'='true'::jsonb)) THEN RAISE EXCEPTION 'Blueprint binding source/rule is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_date_binding'; END IF;
    civil:=binding->>'lastDerivedDate';
    IF binding->'lastDerivedDate'<>'null'::jsonb THEN
      IF jsonb_typeof(binding->'lastDerivedDate')<>'string' OR coalesce(civil,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR civil<'1970-01-01' OR civil>'2200-12-31' THEN RAISE EXCEPTION 'Invalid blueprint civil date' USING ERRCODE='23514',CONSTRAINT='blueprint_date_binding'; END IF;
      BEGIN IF to_char(civil::date,'YYYY-MM-DD')<>civil THEN RAISE invalid_datetime_format; END IF; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'Invalid blueprint civil date' USING ERRCODE='23514',CONSTRAINT='blueprint_date_binding'; END;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_validate_blueprint_state(state jsonb,tenant text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE entry jsonb; weekdays integer[];
BEGIN
  IF state IS NULL OR state='null'::jsonb THEN RETURN; END IF;
  IF jsonb_typeof(state)<>'object' OR (select count(*) from jsonb_object_keys(state))<>7 OR NOT (state ?& ARRAY['revision','generationKey','resolvedManifest','optionalChoices','creationTimezone','workingWeekdays','lastApplicationChangeSetId']) OR coalesce(state->>'revision','') !~ '^[0-9]+$' OR jsonb_typeof(state->'generationKey')<>'string' OR jsonb_typeof(state->'creationTimezone')<>'string' OR coalesce(length(state->>'generationKey'),0)=0 OR coalesce(length(state->>'creationTimezone'),0)=0 OR jsonb_typeof(state->'resolvedManifest')<>'array' OR jsonb_typeof(state->'optionalChoices')<>'array' OR jsonb_typeof(state->'workingWeekdays')<>'array' THEN RAISE EXCEPTION 'Malformed blueprint root state' USING ERRCODE='23514',CONSTRAINT='blueprint_state'; END IF;
  IF jsonb_array_length(state->'resolvedManifest')>500 OR jsonb_array_length(state->'optionalChoices')>499 OR EXISTS(select 1 from jsonb_array_elements(state->'workingWeekdays') AS weekday(value) where weekday.value::text !~ '^[1-7]$') THEN RAISE EXCEPTION 'Blueprint state exceeds its bounds' USING ERRCODE='23514',CONSTRAINT='blueprint_state'; END IF;
  SELECT array_agg(weekday.value::integer ORDER BY weekday.ord) INTO weekdays FROM jsonb_array_elements_text(state->'workingWeekdays') WITH ORDINALITY AS weekday(value,ord);
  IF cardinality(weekdays) NOT BETWEEN 1 AND 7 OR weekdays IS DISTINCT FROM docket_sorted_weekdays(weekdays) THEN RAISE EXCEPTION 'Invalid blueprint weekday snapshot' USING ERRCODE='23514',CONSTRAINT='blueprint_state'; END IF;
  FOR entry IN SELECT json_item.value FROM jsonb_array_elements(state->'resolvedManifest') AS json_item(value) LOOP
    IF NOT (entry ?& ARRAY['path','workTypeId','versionId']) OR jsonb_typeof(entry->'path')<>'array' OR jsonb_array_length(entry->'path')>499 OR (select count(*) from jsonb_object_keys(entry))<>3 OR NOT EXISTS(select 1 from work_type_version v where v.id=entry->>'versionId' and v.work_type_id=entry->>'workTypeId' and v.organization_id=tenant) THEN RAISE EXCEPTION 'Blueprint resolved version is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_state'; END IF;
  END LOOP;
  IF (select count(distinct resolved_member.value->'path') from jsonb_array_elements(state->'resolvedManifest') AS resolved_member(value))<>jsonb_array_length(state->'resolvedManifest') OR (select count(distinct optional_member.value->'path') from jsonb_array_elements(state->'optionalChoices') AS optional_member(value))<>jsonb_array_length(state->'optionalChoices') THEN RAISE EXCEPTION 'Blueprint state paths must be unique' USING ERRCODE='23514',CONSTRAINT='blueprint_state'; END IF;
  FOR entry IN SELECT json_item.value FROM jsonb_array_elements(state->'optionalChoices') AS json_item(value) LOOP
    IF NOT (entry ?& ARRAY['path','selected']) OR jsonb_typeof(entry->'path')<>'array' OR jsonb_array_length(entry->'path') NOT BETWEEN 1 AND 499 OR jsonb_typeof(entry->'selected')<>'boolean' OR (select count(*) from jsonb_object_keys(entry))<>2 THEN RAISE EXCEPTION 'Invalid blueprint optional selection' USING ERRCODE='23514',CONSTRAINT='blueprint_state'; END IF;
  END LOOP;
  IF EXISTS(select 1 from jsonb_array_elements((state->'resolvedManifest')||(state->'optionalChoices')) AS path_row(value) cross join lateral jsonb_array_elements(path_row.value->'path') AS path_key(value) where jsonb_typeof(path_key.value)<>'string' or trim(both '"' from path_key.value::text) !~ '^[a-z][a-z0-9_-]{0,63}$') OR jsonb_typeof(state->'lastApplicationChangeSetId') NOT IN('null','string') THEN RAISE EXCEPTION 'Invalid blueprint state member' USING ERRCODE='23514',CONSTRAINT='blueprint_state'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_work_blueprint_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE value jsonb:=to_jsonb(NEW); previous jsonb; source blueprint_step%ROWTYPE; parent_exists boolean; parent_kind text; parent_value jsonb;
BEGIN
  IF TG_OP='UPDATE' THEN
    previous:=to_jsonb(OLD);
    IF previous->'blueprint_path' IS NOT NULL AND previous->'blueprint_path'<>'null'::jsonb AND (jsonb_build_array(value->'blueprint_step_id',value->'blueprint_source_version_id',value->'blueprint_path',value->'blueprint_parent_kind',value->'blueprint_parent_id') IS DISTINCT FROM jsonb_build_array(previous->'blueprint_step_id',previous->'blueprint_source_version_id',previous->'blueprint_path',previous->'blueprint_parent_kind',previous->'blueprint_parent_id')) THEN RAISE EXCEPTION 'Blueprint creation origin is immutable' USING ERRCODE='23514',CONSTRAINT='blueprint_origin_immutable'; END IF;
    IF previous->'blueprint_ever_started'='true'::jsonb THEN NEW.blueprint_ever_started:=true; END IF;
    IF value->'blueprint_state' IS NOT NULL AND value->'blueprint_state'<>'null'::jsonb AND previous->'blueprint_state' IS NOT NULL AND previous->'blueprint_state'<>'null'::jsonb AND (value->'blueprint_state'->>'revision')::numeric<(previous->'blueprint_state'->>'revision')::numeric THEN RAISE EXCEPTION 'Blueprint revision cannot decrease' USING ERRCODE='23514',CONSTRAINT='blueprint_state'; END IF;
  END IF;
  IF value->>'blueprint_step_id' IS NOT NULL THEN
    SELECT step_row.* INTO source FROM blueprint_step AS step_row WHERE step_row.id=value->>'blueprint_step_id' AND step_row.version_id=value->>'blueprint_source_version_id' AND step_row.organization_id=value->>'organization_id' AND step_row.kind=TG_TABLE_NAME;
    IF NOT FOUND OR jsonb_typeof(value->'blueprint_path')<>'array' OR jsonb_array_length(value->'blueprint_path') NOT BETWEEN 1 AND 499 OR value->'blueprint_path'->>-1<>source.key OR EXISTS(select 1 from jsonb_array_elements(value->'blueprint_path') AS path_member(value) where jsonb_typeof(path_member.value)<>'string' or trim(both '"' from path_member.value::text) !~ '^[a-z][a-z0-9_-]{0,63}$') THEN RAISE EXCEPTION 'Blueprint origin has wrong workspace, version, kind or path' USING ERRCODE='23514',CONSTRAINT='blueprint_origin'; END IF;
  END IF;
  IF value->>'blueprint_parent_id' IS NOT NULL AND (TG_OP='INSERT' OR previous->>'blueprint_parent_id' IS DISTINCT FROM value->>'blueprint_parent_id') THEN
    parent_kind:=value->>'blueprint_parent_kind';
    IF NOT ((parent_kind='initiative' AND TG_TABLE_NAME IN('program','project')) OR (parent_kind='program' AND TG_TABLE_NAME IN('project','task')) OR (parent_kind='project' AND TG_TABLE_NAME IN('milestone','task')) OR (parent_kind IN('milestone','task') AND TG_TABLE_NAME='task')) THEN RAISE EXCEPTION 'Blueprint parent kind is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_parent'; END IF;
    EXECUTE format('select to_jsonb(p) from %I p where id=$1 and organization_id=$2',parent_kind) INTO parent_value USING value->>'blueprint_parent_id',value->>'organization_id';
    IF parent_value IS NULL THEN RAISE EXCEPTION 'Blueprint parent is outside its workspace' USING ERRCODE='23514',CONSTRAINT='blueprint_parent'; END IF;
    IF TG_OP='INSERT' AND parent_kind='milestone' AND (value->>'project_id' IS DISTINCT FROM parent_value->>'project_id' OR value->>'milestone_id' IS DISTINCT FROM parent_value->>'id') THEN RAISE EXCEPTION 'Blueprint Task must retain its Milestone Project' USING ERRCODE='23514',CONSTRAINT='blueprint_parent'; END IF;
  END IF;
  IF TG_TABLE_NAME='task' AND value->>'completed_at' IS NOT NULL THEN NEW.blueprint_ever_started:=true; END IF;
  PERFORM docket_validate_blueprint_binding(value->'blueprint_date_bindings',TG_TABLE_NAME,value->>'organization_id');
  PERFORM docket_validate_blueprint_state(value->'blueprint_state',value->>'organization_id');
  IF TG_TABLE_NAME<>'milestone' AND EXISTS(select 1 from work_status where id=value->>'status_id' and organization_id=value->>'organization_id' and category IN('started','completed')) THEN NEW.blueprint_ever_started:=true; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER initiative_blueprint_guard BEFORE INSERT OR UPDATE ON initiative FOR EACH ROW EXECUTE FUNCTION docket_work_blueprint_guard();
--> statement-breakpoint
CREATE TRIGGER program_blueprint_guard BEFORE INSERT OR UPDATE ON program FOR EACH ROW EXECUTE FUNCTION docket_work_blueprint_guard();
--> statement-breakpoint
CREATE TRIGGER project_blueprint_guard BEFORE INSERT OR UPDATE ON project FOR EACH ROW EXECUTE FUNCTION docket_work_blueprint_guard();
--> statement-breakpoint
CREATE TRIGGER task_blueprint_guard BEFORE INSERT OR UPDATE ON task FOR EACH ROW EXECUTE FUNCTION docket_work_blueprint_guard();
--> statement-breakpoint
CREATE TRIGGER milestone_blueprint_guard BEFORE INSERT OR UPDATE ON milestone FOR EACH ROW EXECUTE FUNCTION docket_work_blueprint_guard();
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_actual_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.task_id IS NOT NULL THEN UPDATE task SET blueprint_ever_started=true WHERE id=NEW.task_id; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER blueprint_actual_work AFTER INSERT OR UPDATE OF task_id ON time_interval FOR EACH ROW EXECUTE FUNCTION docket_blueprint_actual_work();
--> statement-breakpoint
UPDATE task t SET blueprint_ever_started=true WHERE t.completed_at IS NOT NULL OR EXISTS(select 1 from time_interval i where i.task_id=t.id) OR EXISTS(select 1 from work_status s where s.id=t.status_id and s.category IN('started','completed'));
--> statement-breakpoint
UPDATE project w SET blueprint_ever_started=true WHERE EXISTS(select 1 from work_status s where s.id=w.status_id and s.category IN('started','completed'));
--> statement-breakpoint
UPDATE program w SET blueprint_ever_started=true WHERE EXISTS(select 1 from work_status s where s.id=w.status_id and s.category IN('started','completed'));
--> statement-breakpoint
UPDATE initiative w SET blueprint_ever_started=true WHERE EXISTS(select 1 from work_status s where s.id=w.status_id and s.category IN('started','completed'));
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_invocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root jsonb; entry jsonb; payload jsonb:=NEW.manifest; context_row jsonb; field_name text; table_name text; reference_id text; present boolean;
BEGIN
  IF NEW.owner_actor_id IS NOT NULL AND NOT EXISTS(select 1 from actor where id=NEW.owner_actor_id and organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invocation owner is outside its workspace' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
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
CREATE TRIGGER blueprint_invocation_guard BEFORE INSERT OR UPDATE ON work_template_blueprint_invocation FOR EACH ROW EXECUTE FUNCTION docket_blueprint_invocation_guard();
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_conversion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(select 1 from process_revision r join work_template_blueprint_invocation i on i.id=NEW.invocation_id and i.organization_id=r.organization_id where r.id=NEW.legacy_process_revision_id and r.organization_id=NEW.organization_id and i.manifest->>'legacyProcessRevisionId'=r.id) THEN RAISE EXCEPTION 'Blueprint conversion receipt has a foreign source' USING ERRCODE='23514',CONSTRAINT='blueprint_conversion'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER blueprint_conversion_guard BEFORE INSERT ON work_template_blueprint_conversion FOR EACH ROW EXECUTE FUNCTION docket_blueprint_conversion_guard();
--> statement-breakpoint
-- Existing immutable JSON and converted origin/bindings receive the same validation as future writes.
DO $$ DECLARE row record; work_kind text; BEGIN
  FOR row IN SELECT id FROM work_type_version LOOP PERFORM docket_assert_blueprint_projection(row.id); END LOOP;
  FOR work_kind IN SELECT unnest(ARRAY['initiative','program','project','task','milestone']) LOOP
    FOR row IN EXECUTE format('select organization_id,blueprint_date_bindings,blueprint_state,blueprint_step_id,blueprint_source_version_id,blueprint_path from %I',work_kind) LOOP
      PERFORM docket_validate_blueprint_binding(row.blueprint_date_bindings,work_kind,row.organization_id);
      PERFORM docket_validate_blueprint_state(row.blueprint_state,row.organization_id);
      IF row.blueprint_step_id IS NOT NULL AND NOT EXISTS(select 1 from blueprint_step s where s.id=row.blueprint_step_id and s.version_id=row.blueprint_source_version_id and s.organization_id=row.organization_id and s.kind=work_kind and s.key=row.blueprint_path[cardinality(row.blueprint_path)]) THEN RAISE EXCEPTION 'Retained blueprint origin is invalid' USING ERRCODE='23514',CONSTRAINT='blueprint_origin'; END IF;
    END LOOP;
  END LOOP;
END $$;

--> statement-breakpoint
-- Only an authorized exact pair in the caller's transaction permits archived replay.
CREATE OR REPLACE FUNCTION docket_assign_work_template_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.work_type_assignment_source NOT IN ('created', 'migration_baseline', 'changed', 'updated') THEN
    RAISE EXCEPTION 'Unknown template assignment source' USING ERRCODE = '23514', CONSTRAINT = 'work_template_assignment_source';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.work_type_id IS NOT DISTINCT FROM OLD.work_type_id
       AND NEW.work_type_version_id IS NOT DISTINCT FROM OLD.work_type_version_id THEN
      IF NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
      -- Cross-workspace moves keep their content, but cannot carry another workspace's identity.
      NEW.work_type_id := NULL;
      NEW.work_type_version_id := NULL;
    END IF;
  END IF;
  IF NEW.work_type_id IS NULL THEN
    IF NEW.work_type_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'Choose a template with its version' USING ERRCODE = '23514', CONSTRAINT = 'work_template_identity';
    END IF;
    SELECT id, latest_published_version_id INTO NEW.work_type_id, NEW.work_type_version_id FROM template
      WHERE organization_id = NEW.organization_id AND target_type::text = TG_TABLE_NAME AND is_base;
  ELSIF NEW.work_type_version_id IS NULL THEN
    SELECT latest_published_version_id INTO NEW.work_type_version_id FROM template
      WHERE id = NEW.work_type_id AND organization_id = NEW.organization_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM template definition JOIN work_type_version publication
        ON publication.work_type_id = definition.id AND publication.organization_id = definition.organization_id
      WHERE definition.id = NEW.work_type_id AND definition.organization_id = NEW.organization_id
        AND definition.target_type::text = TG_TABLE_NAME AND definition.scope = 'organization'
        AND publication.id = NEW.work_type_version_id
        AND ((definition.publication_state = 'published' AND definition.archived_at IS NULL)
          OR (definition.publication_state = 'archived' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(coalesce(nullif(current_setting('docket.work_template_authorized_archived_versions', true), ''), '[]')::jsonb) AS authorized(value)
            WHERE authorized.value->>'workTypeId' = definition.id AND authorized.value->>'versionId' = publication.id)))) THEN
    RAISE EXCEPTION 'Choose an available published template of the same workspace and kind'
      USING ERRCODE = '23514', CONSTRAINT = 'work_template_identity';
  END IF;
  NEW.work_type_assigned_at := now();
  IF TG_OP = 'UPDATE' AND NEW.work_type_assignment_source IS NOT DISTINCT FROM OLD.work_type_assignment_source THEN
    NEW.work_type_assignment_source := CASE WHEN NEW.work_type_id = OLD.work_type_id THEN 'updated' ELSE 'changed' END;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_occurrence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root jsonb; present boolean;
BEGIN
  IF NEW.blueprint_root_refs IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.blueprint_root_refs)<>'array' OR jsonb_array_length(NEW.blueprint_root_refs)>500 THEN RAISE EXCEPTION 'Invalid blueprint occurrence roots' USING ERRCODE='23514',CONSTRAINT='blueprint_occurrence'; END IF;
  FOR root IN SELECT json_item.value FROM jsonb_array_elements(NEW.blueprint_root_refs) AS json_item(value) LOOP
    IF coalesce(root->>'kind','') NOT IN('project','task') OR jsonb_typeof(root->'key')<>'string' OR (select count(*) from jsonb_object_keys(root))<>3 THEN RAISE EXCEPTION 'Malformed blueprint occurrence root' USING ERRCODE='23514',CONSTRAINT='blueprint_occurrence'; END IF;
    EXECUTE format('select exists(select 1 from %I where id=$1 and organization_id=$2)',root->>'kind') INTO present USING root->>'id',NEW.organization_id;
    IF NOT present THEN RAISE EXCEPTION 'Blueprint occurrence root is outside its workspace' USING ERRCODE='23514',CONSTRAINT='blueprint_occurrence'; END IF;
  END LOOP;
  IF (select count(distinct root_ref.value->>'key') from jsonb_array_elements(NEW.blueprint_root_refs) AS root_ref(value))<>jsonb_array_length(NEW.blueprint_root_refs) THEN RAISE EXCEPTION 'Blueprint occurrence root keys must be unique' USING ERRCODE='23514',CONSTRAINT='blueprint_occurrence'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER blueprint_occurrence_guard BEFORE INSERT OR UPDATE OF blueprint_root_refs ON process_occurrence FOR EACH ROW EXECUTE FUNCTION docket_blueprint_occurrence_guard();
