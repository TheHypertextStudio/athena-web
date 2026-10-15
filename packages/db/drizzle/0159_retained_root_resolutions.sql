ALTER TABLE "process_occurrence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "blueprint_occurrence_private" ON "process_occurrence" AS PERMISSIVE FOR ALL TO public USING ("process_occurrence"."organization_id"=nullif(current_setting('docket.organization_id',true),'') and ("process_occurrence"."blueprint_invocation_id" is null or exists(select 1 from work_template_blueprint_invocation i where i.id="process_occurrence"."blueprint_invocation_id" and i.organization_id="process_occurrence"."organization_id"))) WITH CHECK ("process_occurrence"."organization_id"=nullif(current_setting('docket.organization_id',true),'') and ("process_occurrence"."blueprint_invocation_id" is null or exists(select 1 from work_template_blueprint_invocation i where i.id="process_occurrence"."blueprint_invocation_id" and i.organization_id="process_occurrence"."organization_id")));
--> statement-breakpoint
CREATE FUNCTION docket_validate_retained_root_manifest(manifest jsonb,original_root jsonb,tenant text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item jsonb; parent_item jsonb; source_step jsonb; child template%ROWTYPE; root_item jsonb;
BEGIN
  IF coalesce(jsonb_typeof(manifest),'')<>'array' THEN RAISE EXCEPTION 'Malformed retained accepted closure' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
  IF jsonb_array_length(manifest) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Retained accepted closure exceeds its bound' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
  FOR item IN SELECT resolution_item.value FROM jsonb_array_elements(manifest) AS resolution_item(value) LOOP
    IF coalesce(jsonb_typeof(item),'')<>'object' OR NOT (item ?& ARRAY['path','workTypeId','versionId']) OR (select count(*) from jsonb_object_keys(item))<>3 OR coalesce(jsonb_typeof(item->'path'),'')<>'array' THEN RAISE EXCEPTION 'Malformed retained resolution' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
    IF jsonb_array_length(item->'path')>499 OR EXISTS(select 1 from jsonb_array_elements(item->'path') AS path_component(value) where jsonb_typeof(path_component.value)<>'string' or trim(both '"' from path_component.value::text) !~ '^[a-z][a-z0-9_-]{0,63}$') THEN RAISE EXCEPTION 'Malformed retained resolution path' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
    IF NOT EXISTS(select 1 from work_type_version publication join template definition on definition.id=publication.work_type_id and definition.organization_id=tenant where publication.id=item->>'versionId' and publication.work_type_id=item->>'workTypeId' and publication.organization_id=tenant and definition.scope='organization' and definition.publication_state in('published','archived')) THEN RAISE EXCEPTION 'Retained resolution publication is outside its workspace' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
  END LOOP;
  IF (select count(distinct resolution_item.value->'path') from jsonb_array_elements(manifest) AS resolution_item(value))<>jsonb_array_length(manifest) THEN RAISE EXCEPTION 'Retained resolution paths must be unique' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
  SELECT resolution_item.value INTO root_item FROM jsonb_array_elements(manifest) AS resolution_item(value) WHERE resolution_item.value->'path'='[]'::jsonb;
  IF root_item IS NULL OR root_item->>'workTypeId' IS DISTINCT FROM original_root->>'workTypeId' OR root_item->>'versionId' IS DISTINCT FROM original_root->>'workTypeVersionId' THEN RAISE EXCEPTION 'Retained resolution differs from its original root publication' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
  FOR item IN SELECT resolution_item.value FROM jsonb_array_elements(manifest) AS resolution_item(value) WHERE resolution_item.value->'path'<>'[]'::jsonb LOOP
    SELECT resolution_item.value INTO parent_item FROM jsonb_array_elements(manifest) AS resolution_item(value) WHERE resolution_item.value->'path'=(select coalesce(jsonb_agg(path_component.value ORDER BY path_component.ordinal),'[]'::jsonb) from jsonb_array_elements(item->'path') WITH ORDINALITY AS path_component(value,ordinal) where path_component.ordinal<jsonb_array_length(item->'path'));
    SELECT step_row.step INTO source_step FROM blueprint_step step_row WHERE step_row.organization_id=tenant AND step_row.version_id=parent_item->>'versionId' AND step_row.key=item->'path'->>-1;
    SELECT definition.* INTO child FROM template definition WHERE definition.id=item->>'workTypeId' AND definition.organization_id=tenant;
    IF parent_item IS NULL OR source_step IS NULL OR source_step->>'kind' IS DISTINCT FROM child.target_type::text THEN RAISE EXCEPTION 'Retained resolution has no matching immutable source step' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
    IF source_step->'template'='null'::jsonb THEN
      IF NOT child.is_base THEN RAISE EXCEPTION 'Inline retained resolution requires its same-kind base' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
    ELSIF source_step->'template'->>'workTypeId' IS DISTINCT FROM item->>'workTypeId' OR (source_step->'template'->'selection'->>'kind'='pinned' AND source_step->'template'->'selection'->>'workTypeVersionId' IS DISTINCT FROM item->>'versionId') THEN RAISE EXCEPTION 'Retained resolution changed its immutable template reference' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_retained_root_receipt_manifest(tenant text,occurrence_id text,root_ref jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(proof.manifest))->0 ELSE NULL END FROM (
    SELECT DISTINCT receipt_entry.after->'blueprintState'->'resolvedManifest' AS manifest
    FROM process_occurrence occurrence_row
    JOIN work_template_blueprint_invocation invocation_row ON invocation_row.id=occurrence_row.blueprint_invocation_id AND invocation_row.organization_id=tenant
    CROSS JOIN LATERAL jsonb_array_elements(invocation_row.manifest->'roots') AS original_root(value)
    JOIN change_set receipt ON receipt.organization_id=tenant AND receipt.origin->>'channel'='rule' AND receipt.origin->>'surface'='recurrence' AND receipt.origin->>'tool'='recurrence_materialize' AND receipt.origin->'ref'->>'seriesId'=occurrence_row.series_id AND receipt.undone_at IS NULL
    JOIN change_set_entry receipt_entry ON receipt_entry.change_set_id=receipt.id AND receipt_entry.entity_kind=root_ref->>'kind' AND receipt_entry.entity_id=root_ref->>'id' AND receipt_entry.op='create'
    WHERE occurrence_row.id=occurrence_id AND occurrence_row.organization_id=tenant AND original_root.value->>'sourceKey'=root_ref->>'key' AND original_root.value->>'kind'=root_ref->>'kind'
      AND receipt_entry.after->>'workTypeId'=original_root.value->>'workTypeId' AND receipt_entry.after->>'workTypeVersionId'=original_root.value->>'workTypeVersionId'
      AND receipt_entry.after->'blueprintState'->>'generationKey'=root_ref->>'id' AND jsonb_typeof(receipt_entry.after->'blueprintState'->'resolvedManifest')='array'
    LIMIT 2
  ) proof;
$$;
--> statement-breakpoint
CREATE FUNCTION docket_validate_retained_selected_work(selected_rows jsonb,manifest jsonb,root_ref jsonb,invocation_manifest jsonb,tenant text,occurrence_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE selected_row jsonb; stored_row jsonb; source_projection blueprint_step%ROWTYPE; scope_path jsonb; parent_path jsonb; parent_selection jsonb; scope_version text; mapped boolean;
BEGIN
  IF coalesce(jsonb_typeof(selected_rows),'')<>'array' OR jsonb_array_length(selected_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Retained selected work exceeds its bound' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
  FOR selected_row IN SELECT selection_row.value FROM jsonb_array_elements(selected_rows) AS selection_row(value) LOOP
    IF coalesce(jsonb_typeof(selected_row),'')<>'object' OR NOT(selected_row ?& ARRAY['path','kind','id']) OR (select count(*) from jsonb_object_keys(selected_row))<>3 OR coalesce(selected_row->>'kind','') NOT IN('program','project','task','milestone') OR coalesce(jsonb_typeof(selected_row->'id'),'')<>'string' OR length(selected_row->>'id')=0 OR coalesce(jsonb_typeof(selected_row->'path'),'')<>'array' THEN RAISE EXCEPTION 'Malformed retained selected work' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    IF jsonb_array_length(selected_row->'path')>499 OR EXISTS(select 1 from jsonb_array_elements(selected_row->'path') AS path_part(value) where jsonb_typeof(path_part.value)<>'string' or trim(both '"' from path_part.value::text) !~ '^[a-z][a-z0-9_-]{0,63}$') THEN RAISE EXCEPTION 'Malformed retained selected path' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    IF selected_row->>'kind'<>'milestone' AND NOT EXISTS(select 1 from jsonb_array_elements(manifest) AS resolution_row(value) join template definition on definition.organization_id=tenant and definition.id=resolution_row.value->>'workTypeId' where resolution_row.value->'path'=selected_row->'path' and definition.target_type::text=selected_row->>'kind') THEN RAISE EXCEPTION 'Retained selected work has no accepted identity' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    EXECUTE format('select to_jsonb(work_row) from %I work_row where work_row.organization_id=$1 and work_row.id=$2',selected_row->>'kind') INTO stored_row USING tenant,selected_row->>'id';
    IF stored_row IS NULL THEN RAISE EXCEPTION 'Retained selected work is outside its workspace' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    IF selected_row->'path'='[]'::jsonb THEN
      IF selected_row->>'kind' IS DISTINCT FROM root_ref->>'kind' OR selected_row->>'id' IS DISTINCT FROM root_ref->>'id' THEN RAISE EXCEPTION 'Retained selected root changed' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
      CONTINUE;
    END IF;
    SELECT coalesce(jsonb_agg(path_part.value ORDER BY path_part.ordinal),'[]'::jsonb) INTO scope_path FROM jsonb_array_elements(selected_row->'path') WITH ORDINALITY AS path_part(value,ordinal) WHERE path_part.ordinal<jsonb_array_length(selected_row->'path');
    SELECT resolution_row.value->>'versionId' INTO scope_version FROM jsonb_array_elements(manifest) AS resolution_row(value) WHERE resolution_row.value->'path'=scope_path;
    SELECT projection.* INTO source_projection FROM blueprint_step projection WHERE projection.organization_id=tenant AND projection.version_id=scope_version AND projection.key=selected_row->'path'->>-1;
    IF source_projection.id IS NULL OR source_projection.kind::text IS DISTINCT FROM selected_row->>'kind' THEN RAISE EXCEPTION 'Retained selected work has no original source projection' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    parent_path:=CASE WHEN source_projection.parent_step_key IS NULL THEN scope_path ELSE scope_path || jsonb_build_array(source_projection.parent_step_key) END;
    SELECT selection_row.value INTO parent_selection FROM jsonb_array_elements(selected_rows) AS selection_row(value) WHERE selection_row.value->'path'=parent_path;
    IF parent_selection IS NULL THEN RAISE EXCEPTION 'Retained selected parent is missing' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    mapped:=false;
    IF selected_row->>'kind' IN('project','task','milestone') THEN
      EXECUTE format('select exists(select 1 from process_instance_%I legacy_map join process_instance instance_row on instance_row.id=legacy_map.instance_id and instance_row.organization_id=$1 cross join lateral jsonb_array_elements($4->''steps'') source_item(value) where legacy_map.organization_id=$1 and instance_row.occurrence_id=$2 and legacy_map.%I=$3 and source_item.value->>''sourceStepId''=legacy_map.step_id and source_item.value->>''blueprintStepId''=$5 and source_item.value->>''sourceVersionId''=$6 and source_item.value->>''rootKey''=(select original_root.value->>''key'' from jsonb_array_elements($4->''roots'') original_root(value) where original_root.value->>''sourceKey''=$7))',selected_row->>'kind',(selected_row->>'kind')||'_id') INTO mapped USING tenant,occurrence_id,selected_row->>'id',invocation_manifest,source_projection.id,scope_version,root_ref->>'key';
    END IF;
    IF NOT mapped AND (stored_row->>'blueprint_step_id' IS DISTINCT FROM source_projection.id OR stored_row->>'blueprint_source_version_id' IS DISTINCT FROM scope_version OR to_jsonb(ARRAY(SELECT path_part.value FROM jsonb_array_elements_text(selected_row->'path') AS path_part(value))) IS DISTINCT FROM stored_row->'blueprint_path' OR stored_row->>'blueprint_parent_kind' IS DISTINCT FROM parent_selection->>'kind' OR stored_row->>'blueprint_parent_id' IS DISTINCT FROM parent_selection->>'id') THEN RAISE EXCEPTION 'Retained selected work differs from its immutable origin' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
  END LOOP;
  IF EXISTS(select 1 from jsonb_array_elements(manifest) AS resolution_row(value) where not exists(select 1 from jsonb_array_elements(selected_rows) AS selection_row(value) where selection_row.value->'path'=resolution_row.value->'path')) THEN RAISE EXCEPTION 'Retained accepted identity has no selected work' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
  IF NOT EXISTS(select 1 from jsonb_array_elements(selected_rows) AS selection_row(value) where selection_row.value->'path'='[]'::jsonb) OR (select count(distinct selection_row.value->'path') from jsonb_array_elements(selected_rows) AS selection_row(value))<>jsonb_array_length(selected_rows) OR (select count(distinct jsonb_build_array(selection_row.value->>'kind',selection_row.value->>'id')) from jsonb_array_elements(selected_rows) AS selection_row(value))<>jsonb_array_length(selected_rows) THEN RAISE EXCEPTION 'Retained selected paths and identities must be unique' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_blueprint_occurrence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_ref jsonb; previous_root jsonb; invocation_manifest jsonb; original_root jsonb; present boolean; resolution_count integer:=0; selected_count integer:=0;
BEGIN
  IF TG_OP='UPDATE' AND OLD.blueprint_root_refs IS NOT NULL THEN
    FOR previous_root IN SELECT old_ref.value FROM jsonb_array_elements(OLD.blueprint_root_refs) AS old_ref(value) WHERE old_ref.value ? 'resolvedManifest' LOOP
      IF NEW.blueprint_root_refs IS NULL OR NOT EXISTS(select 1 from jsonb_array_elements(NEW.blueprint_root_refs) AS new_ref(value) where new_ref.value=previous_root) THEN RAISE EXCEPTION 'Accepted retained root resolution is immutable' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution_immutable'; END IF;
    END LOOP;
  END IF;
  IF NEW.blueprint_root_refs IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.blueprint_root_refs)<>'array' OR jsonb_array_length(NEW.blueprint_root_refs)>500 THEN RAISE EXCEPTION 'Invalid blueprint occurrence roots' USING ERRCODE='23514',CONSTRAINT='blueprint_occurrence'; END IF;
  SELECT invocation_row.manifest INTO invocation_manifest FROM work_template_blueprint_invocation invocation_row WHERE invocation_row.id=NEW.blueprint_invocation_id AND invocation_row.organization_id=NEW.organization_id;
  FOR root_ref IN SELECT current_ref.value FROM jsonb_array_elements(NEW.blueprint_root_refs) AS current_ref(value) LOOP
    IF coalesce(jsonb_typeof(root_ref),'')<>'object' OR NOT (root_ref ?& ARRAY['key','kind','id']) OR coalesce(root_ref->>'kind','') NOT IN('project','task') OR jsonb_typeof(root_ref->'key')<>'string' OR jsonb_typeof(root_ref->'id')<>'string' OR length(root_ref->>'key')=0 OR length(root_ref->>'id')=0 OR EXISTS(select 1 from jsonb_object_keys(root_ref) AS root_member(key) where root_member.key NOT IN('key','kind','id','resolvedManifest','selectedWork')) THEN RAISE EXCEPTION 'Malformed blueprint occurrence root' USING ERRCODE='23514',CONSTRAINT='blueprint_occurrence'; END IF;
    previous_root:=NULL;
    IF TG_OP='UPDATE' THEN SELECT old_ref.value INTO previous_root FROM jsonb_array_elements(coalesce(OLD.blueprint_root_refs,'[]'::jsonb)) AS old_ref(value) WHERE old_ref.value->>'key'=root_ref->>'key'; END IF;
    IF previous_root IS DISTINCT FROM root_ref THEN
      EXECUTE format('select exists(select 1 from %I where id=$1 and organization_id=$2)',root_ref->>'kind') INTO present USING root_ref->>'id',NEW.organization_id;
      IF NOT present THEN RAISE EXCEPTION 'Blueprint occurrence root is outside its workspace' USING ERRCODE='23514',CONSTRAINT='blueprint_occurrence'; END IF;
    END IF;
    IF root_ref ? 'selectedWork' AND NOT(root_ref ? 'resolvedManifest') THEN RAISE EXCEPTION 'Retained selected work requires its accepted closure' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    IF root_ref ? 'resolvedManifest' THEN
      SELECT original_ref.value INTO original_root FROM jsonb_array_elements(invocation_manifest->'roots') AS original_ref(value) WHERE original_ref.value->>'sourceKey'=root_ref->>'key';
      IF coalesce(invocation_manifest->>'kind','')<>'published' OR original_root IS NULL OR original_root->>'kind' IS DISTINCT FROM root_ref->>'kind' THEN RAISE EXCEPTION 'Retained accepted closure has no original publication binding' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
      PERFORM docket_validate_retained_root_manifest(root_ref->'resolvedManifest',original_root,NEW.organization_id);
      resolution_count:=resolution_count+jsonb_array_length(root_ref->'resolvedManifest');
      IF resolution_count>500 THEN RAISE EXCEPTION 'Retained forest resolution exceeds500 entries' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
      IF root_ref ? 'selectedWork' THEN
        selected_count:=selected_count+jsonb_array_length(root_ref->'selectedWork');
        IF selected_count>500 THEN RAISE EXCEPTION 'Retained selected forest exceeds500 entries' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
        IF previous_root IS DISTINCT FROM root_ref THEN
          IF TG_OP='UPDATE' AND OLD.blueprint_applied_at IS NOT NULL THEN RAISE EXCEPTION 'Previously applied work selection requires original row proof' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
          PERFORM docket_validate_retained_selected_work(root_ref->'selectedWork',root_ref->'resolvedManifest',root_ref,invocation_manifest,NEW.organization_id,NEW.id);
        END IF;
      END IF;
      IF NOT (coalesce(previous_root,'{}'::jsonb) ? 'resolvedManifest') THEN
        IF TG_OP='UPDATE' AND OLD.blueprint_applied_at IS NOT NULL AND docket_retained_root_receipt_manifest(NEW.organization_id,NEW.id,root_ref) IS DISTINCT FROM root_ref->'resolvedManifest' THEN RAISE EXCEPTION 'Applied retained closure requires its original creation receipt' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution_receipt'; END IF;
        IF root_ref->>'kind'='project' THEN
          SELECT EXISTS(select 1 from process_instance_project mapped_root join process_instance instance_row on instance_row.id=mapped_root.instance_id and instance_row.organization_id=NEW.organization_id where mapped_root.organization_id=NEW.organization_id and mapped_root.step_id=original_root->>'sourceStepId' and mapped_root.project_id=root_ref->>'id' and instance_row.occurrence_id=NEW.id) INTO present;
        ELSE
          SELECT EXISTS(select 1 from process_instance_task mapped_root join process_instance instance_row on instance_row.id=mapped_root.instance_id and instance_row.organization_id=NEW.organization_id where mapped_root.organization_id=NEW.organization_id and mapped_root.step_id=original_root->>'sourceStepId' and mapped_root.task_id=root_ref->>'id' and instance_row.occurrence_id=NEW.id) INTO present;
        END IF;
        IF NOT present THEN RAISE EXCEPTION 'Retained accepted closure has no exact original work mapping' USING ERRCODE='23514',CONSTRAINT='retained_root_resolution'; END IF;
      END IF;
    END IF;
  END LOOP;
  IF (select count(distinct current_ref.value->>'key') from jsonb_array_elements(NEW.blueprint_root_refs) AS current_ref(value))<>jsonb_array_length(NEW.blueprint_root_refs) THEN RAISE EXCEPTION 'Blueprint occurrence root keys must be unique' USING ERRCODE='23514',CONSTRAINT='blueprint_occurrence'; END IF;
  RETURN NEW;
END $$;
