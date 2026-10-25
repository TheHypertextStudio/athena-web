ALTER TABLE recurrence_series_revision
ADD COLUMN conversion_receipt jsonb;

--> statement-breakpoint
ALTER TABLE recurrence_series_revision
ADD COLUMN conversion_receipt_hash text;

--> statement-breakpoint
ALTER TABLE recurrence_series_revision
ADD COLUMN conversion_review jsonb;

--> statement-breakpoint
ALTER TABLE recurrence_series_revision
ADD CONSTRAINT schedule_conversion_receipt_shape CHECK (
  (
    conversion_receipt IS NULL
    AND conversion_receipt_hash IS NULL
  )
  OR (
    conversion_receipt IS NOT NULL
    AND conversion_receipt_hash IS NOT NULL
    AND conversion_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
  )
);

--> statement-breakpoint
ALTER TABLE recurrence_series_revision
ADD CONSTRAINT schedule_conversion_review_shape CHECK (
  conversion_review IS NULL
  OR (
    docket_schedule_keys (
      conversion_review,
      ARRAY['kind', 'revision', 'execution', 'code']
    )
    AND conversion_review ->> 'kind' = 'schedule_conversion_review'
    AND conversion_review -> 'revision' = '1'::jsonb
    AND conversion_review ->> 'execution' = 'nonexecuting'
    AND conversion_review ->> 'code' IN (
      'original_source_unproved',
      'alias_unproved',
      'timezone_unproved',
      'closure_unproved',
      'pending_source',
      'missing_selection',
      'oversized_source',
      'invalid_structure',
      'unsupported_timing'
    )
  )
);

--> statement-breakpoint
CREATE FUNCTION docket_schedule_conversion_publications_proved (publications jsonb, tenant text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(jsonb_typeof(publications)='array' AND jsonb_array_length(publications) BETWEEN 1 AND 500
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(publications) p(value)
    WHERE NOT coalesce(docket_schedule_keys(p.value,ARRAY['rootKey','path','workTypeId','versionId','definitionHash'])
      AND docket_schedule_v2_ref(jsonb_build_object('rootKey',p.value->'rootKey','path',p.value->'path'),jsonb_build_object('roots',jsonb_build_array(jsonb_build_object('key',p.value->'rootKey'))))
      AND EXISTS(SELECT 1 FROM work_type_version v WHERE v.id=p.value->>'versionId' AND v.work_type_id=p.value->>'workTypeId'
        AND v.organization_id=tenant AND p.value->>'definitionHash'=docket_schedule_fingerprint(v.definition)),false))
  AND (SELECT count(DISTINCT (value->>'rootKey',value->'path'))=count(*) FROM jsonb_array_elements(publications)),false)
$$;

--> statement-breakpoint
CREATE FUNCTION docket_schedule_conversion_mapping (
  projection jsonb,
  document jsonb,
  publications jsonb
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry jsonb; original jsonb; reference jsonb; matches integer; owner_path jsonb; result jsonb:='[]'::jsonb;
BEGIN
 FOR entry IN SELECT value FROM jsonb_array_elements(projection->'steps') ORDER BY (value->>'sort')::integer,value->>'alias' LOOP
  SELECT value INTO original FROM jsonb_array_elements(document->'steps') WHERE value->>'sourceStepId'=entry->>'alias';
  IF original IS NULL THEN RETURN NULL; END IF;
  IF entry->'path'='[]'::jsonb THEN reference:=jsonb_build_object('rootKey',entry->'rootKey','path','[]'::jsonb);
  ELSE
    SELECT count(*),jsonb_agg(value->'path')->0 INTO matches,owner_path FROM jsonb_array_elements(publications)
     WHERE value->'rootKey'=entry->'rootKey' AND value->'versionId'=original->'sourceVersionId';
    IF matches<>1 THEN RETURN NULL; END IF;
    reference:=jsonb_build_object('rootKey',entry->'rootKey','path',owner_path || jsonb_build_array(entry->'path'->(jsonb_array_length(entry->'path')-1)));
  END IF;
  result:=result || jsonb_build_array(jsonb_build_object('alias',entry->'alias','sourceKey',entry->'key','reference',reference,'kind',entry->'kind','sort',entry->'sort'));
 END LOOP;
 RETURN result;
 EXCEPTION WHEN others THEN RETURN NULL;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_schedule_conversion_policies (
  candidate jsonb,
  projection jsonb,
  overrides jsonb
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE entry jsonb; preset jsonb; target jsonb; source_ref jsonb; field text; primary_field text; literal_name text; literal jsonb;
 rules jsonb:='[]'::jsonb; absent jsonb:='[]'::jsonb; titles jsonb:='[]'::jsonb; tasks jsonb:='[]'::jsonb; anchor jsonb; days jsonb;
BEGIN
 FOR entry IN SELECT value FROM jsonb_array_elements(candidate->'sourceMappings') ORDER BY (value->>'sort')::integer,value->>'alias' LOOP
  SELECT value INTO preset FROM jsonb_array_elements(overrides) WHERE value->>'sourceStepId'=entry->>'alias';
  IF preset IS NULL OR preset->>'kind' IS DISTINCT FROM entry->>'kind' THEN RETURN false; END IF;
  target:=entry->'reference';
  titles:=titles || jsonb_build_array(jsonb_build_object('target',target,'kind',entry->'kind','pattern',preset->'fields'->(CASE WHEN entry->>'kind'='task' THEN 'title' ELSE 'name' END)));
  IF entry->>'kind'='task' THEN tasks:=tasks || jsonb_build_array(target); END IF;
  primary_field:=CASE WHEN entry->>'kind'='task' THEN 'dueDate' WHEN entry->>'kind'='project' THEN 'startDate' ELSE 'targetDate' END;
  FOREACH field IN ARRAY (CASE WHEN entry->>'kind'='task' THEN ARRAY['startDate','dueDate'] WHEN entry->>'kind'='project' THEN ARRAY['startDate','targetDate'] ELSE ARRAY['targetDate'] END) LOOP
    literal_name:=CASE WHEN field='startDate' THEN 'start_offset_days' WHEN field='dueDate' THEN 'due_offset_days' ELSE 'target_offset_days' END;
    literal:=preset->'fields'->literal_name;
    IF jsonb_typeof(literal)='number' THEN anchor:=jsonb_build_object('kind','run');days:=literal;
    ELSIF field<>primary_field THEN absent:=absent || jsonb_build_array(target || jsonb_build_object('field',field));CONTINUE;
    ELSIF preset->'timing'->>'kind'='after_step_completion' THEN
      SELECT value->'reference' INTO source_ref FROM jsonb_array_elements(candidate->'sourceMappings') WHERE value->>'alias'=preset->'timing'->>'afterStepId';
      IF source_ref IS NULL THEN RETURN false; END IF;
      anchor:=jsonb_build_object('kind','after_completion','works',jsonb_build_array(source_ref));days:=preset->'timing'->'offsetDays';
    ELSE anchor:=jsonb_build_object('kind','run');days:=CASE WHEN preset->'timing'->>'kind'='on_trigger' THEN '0'::jsonb ELSE preset->'timing'->'offsetDays' END;
    END IF;
    rules:=rules || jsonb_build_array(jsonb_build_object('target',target || jsonb_build_object('field',field),'source',anchor,'offset',jsonb_build_object('days',days,'unit','calendar')));
  END LOOP;
 END LOOP;
 RETURN coalesce(candidate->'timing'=jsonb_build_object('kind','field_timing','revision',2,'rules',rules)
   AND candidate->'absentFields'=absent AND candidate->'titlePolicy'=jsonb_build_object('kind','legacy_title','revision',1)
   AND candidate->'titles'=titles AND candidate->'completionPolicy'=jsonb_build_object('kind','legacy_authored_tasks','revision',1,'tasks',tasks),false);
 EXCEPTION WHEN others THEN RETURN false;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_schedule_conversion_selection (candidate jsonb, publications jsonb, tenant text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE selected jsonb; mapped jsonb; publication jsonb; valid boolean; path jsonb;
BEGIN
 IF jsonb_typeof(candidate->'selectedWork') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF (SELECT count(*)<>count(DISTINCT value->'reference') FROM jsonb_array_elements(candidate->'selectedWork')) THEN RETURN false; END IF;
 FOR mapped IN SELECT value FROM jsonb_array_elements(candidate->'sourceMappings') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidate->'selectedWork') s(value) WHERE s.value->'reference'=mapped->'reference' AND s.value->'kind'=mapped->'kind') THEN RETURN false; END IF;
 END LOOP;
 FOR selected IN SELECT value FROM jsonb_array_elements(candidate->'selectedWork') LOOP
  IF NOT docket_schedule_keys(selected,ARRAY['reference','kind']) THEN RETURN false; END IF;
  path:=selected->'reference'->'path';
  IF path='[]'::jsonb THEN
    valid:=EXISTS(SELECT 1 FROM jsonb_array_elements(candidate->'roots') root(value) WHERE root.value->'key'=selected->'reference'->'rootKey' AND root.value->'root'->'kind'=selected->'kind');
  ELSE
    valid:=EXISTS(SELECT 1 FROM jsonb_array_elements(publications) p(value) JOIN work_type_version v ON v.id=p.value->>'versionId' AND v.organization_id=tenant
      CROSS JOIN LATERAL jsonb_array_elements(v.definition->'blueprint'->'steps') step(value)
      WHERE p.value->'rootKey'=selected->'reference'->'rootKey' AND p.value->'path'=(path-(jsonb_array_length(path)-1))
       AND step.value->'key'=path->(jsonb_array_length(path)-1) AND step.value->'kind'=selected->'kind');
  END IF;
  IF NOT coalesce(valid,false) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
 EXCEPTION WHEN others THEN RETURN false;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_guard_schedule_conversion_preparation () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; candidate jsonb; v work_template_invocation_revision; c work_template_blueprint_conversion;
 document jsonb; private_overrides jsonb; definition_alias text; mapping jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.conversion_receipt IS NOT NULL THEN
   IF NEW.conversion_receipt IS DISTINCT FROM OLD.conversion_receipt OR NEW.conversion_receipt_hash IS DISTINCT FROM OLD.conversion_receipt_hash THEN
     RAISE EXCEPTION 'Prepared conversion receipts are immutable' USING ERRCODE='23514',CONSTRAINT='schedule_conversion_immutable';
   END IF;
   RETURN NEW;
 END IF;
 r:=NEW.conversion_receipt;
 IF r IS NULL THEN RETURN NEW; END IF;
 SELECT definition_id INTO definition_alias FROM recurrence_series WHERE id=NEW.series_id AND organization_id=NEW.organization_id;
 SELECT * INTO v FROM work_template_invocation_revision WHERE id=NEW.process_revision_id AND head_id=definition_alias AND organization_id=NEW.organization_id AND invocation_id=NEW.blueprint_invocation_id;
 SELECT * INTO c FROM work_template_blueprint_conversion WHERE legacy_process_revision_id=v.id AND organization_id=v.organization_id AND invocation_id=v.invocation_id;
 SELECT manifest,overrides INTO document,private_overrides FROM work_template_blueprint_invocation WHERE id=v.invocation_id AND organization_id=v.organization_id;
 candidate:=r->'candidate';
 mapping:=docket_schedule_conversion_mapping(v.projection,document,r->'publications');
 IF NOT coalesce(
   docket_schedule_keys(r,ARRAY['kind','revision','execution','compiler','identity','candidate','publications','timezone'])
   AND r->>'kind'='schedule_conversion' AND r->'revision'='1'::jsonb AND r->>'execution'='nonexecuting' AND r->>'compiler'='legacy_schedule_v2.1'
   AND NEW.schedule_draft IS NULL AND NEW.authoring_fallback IS NULL AND NEW.conversion_review IS NULL
   AND NEW.conversion_receipt_hash=docket_schedule_fingerprint(r)
   AND r->'identity'=jsonb_build_object('organizationId',NEW.organization_id,'seriesId',NEW.series_id,'seriesRevisionId',NEW.id,'headId',definition_alias,'revisionAlias',v.id,'invocationId',v.invocation_id)
   AND v.origin='retained' AND v.state='published' AND document->>'kind'='published'
   AND c.source_archive IS NOT NULL AND c.source_archive_hash=docket_schedule_fingerprint(c.source_archive)
   AND v.source_archive_hash=c.source_archive_hash AND v.original_source_fingerprint=c.source_fingerprint
   AND md5((c.source_archive->'source')::text)=v.original_source_fingerprint
   AND (docket_blueprint_retained_source(v.id)-'definition')=((c.source_archive->'source')-'definition')
   AND NEW.trigger_kind::text='calendar' AND length(NEW.timezone)>0
   AND r->'timezone'=jsonb_build_object('kind','calendar_revision','timezone',NEW.timezone)
   AND docket_schedule_keys(candidate,ARRAY['kind','revision','state','creationMode','source','roots','sourceMappings','selectedWork','timing','absentFields','titlePolicy','titles','completionPolicy'])
   AND candidate->>'kind'='imported_schedule' AND candidate->'revision'='2'::jsonb AND candidate->>'state'='published'
   AND candidate->>'creationMode'=v.creation_mode
   AND candidate->'source'=jsonb_build_object('kind','retained_source','revision',1,'revisionAlias',v.id,'invocationId',v.invocation_id,'originalFingerprint',v.original_source_fingerprint,'archiveHash',v.source_archive_hash)
   AND candidate->'sourceMappings'=mapping
   AND jsonb_typeof(candidate->'roots')='array' AND jsonb_array_length(candidate->'roots')=jsonb_array_length(document->'roots')
   AND jsonb_typeof(candidate->'selectedWork')='array' AND jsonb_array_length(candidate->'selectedWork') BETWEEN 1 AND 500
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidate->'roots') root(value) WHERE NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(document->'roots') original(value) WHERE original.value->'key'=root.value->'key'
       AND root.value->'template'=jsonb_build_object('targetType',original.value->'kind','workTypeId',original.value->'workTypeId','selection',jsonb_build_object('kind','pinned','workTypeVersionId',original.value->'workTypeVersionId'))
       AND root.value->'root'->'kind'=original.value->'kind'
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'publications') p(value) WHERE p.value->'rootKey'=root.value->'key' AND p.value->'path'='[]'::jsonb
         AND p.value->'workTypeId'=original.value->'workTypeId' AND p.value->'versionId'=original.value->'workTypeVersionId')))
   AND docket_schedule_conversion_publications_proved(r->'publications',NEW.organization_id)
   AND docket_schedule_conversion_policies(candidate,v.projection,private_overrides)
   AND docket_schedule_conversion_selection(candidate,r->'publications',NEW.organization_id),false) THEN
   RAISE EXCEPTION 'Conversion preparation requires exact original private facts' USING ERRCODE='23514',CONSTRAINT='schedule_conversion_proof';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER schedule_conversion_preparation_guard
BEFORE INSERT OR UPDATE ON recurrence_series_revision FOR EACH ROW
EXECUTE FUNCTION docket_guard_schedule_conversion_preparation ();
