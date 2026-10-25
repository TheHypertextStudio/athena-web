ALTER TABLE process_occurrence
ADD COLUMN imported_history_receipt jsonb;

--> statement-breakpoint
ALTER TABLE process_occurrence
ADD COLUMN imported_history_receipt_hash text;

--> statement-breakpoint
ALTER TABLE process_occurrence
ADD COLUMN history_import_review jsonb;

--> statement-breakpoint
ALTER TABLE process_occurrence
ADD CONSTRAINT schedule_import_review_shape CHECK (
  history_import_review IS NULL
  OR (
    docket_schedule_keys (
      history_import_review,
      ARRAY['kind', 'revision', 'execution', 'code']
    )
    AND history_import_review ->> 'kind' = 'history_import_review'
    AND history_import_review -> 'revision' = '1'::jsonb
    AND history_import_review ->> 'execution' = 'nonexecuting'
    AND history_import_review ->> 'code' IN (
      'current_run_requires_barrier',
      'original_source_unproved',
      'history_identity_unproved'
    )
  )
);

--> statement-breakpoint
ALTER TABLE process_occurrence
ADD CONSTRAINT schedule_import_history_shape CHECK (
  (
    imported_history_receipt IS NULL
    AND imported_history_receipt_hash IS NULL
  )
  OR (
    imported_history_receipt IS NOT NULL
    AND imported_history_receipt_hash IS NOT NULL
    AND imported_history_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
    AND accepted_claim IS NULL
  )
);

--> statement-breakpoint
CREATE FUNCTION docket_schedule_history_references_proved (
  archive jsonb,
  source jsonb,
  tenant text,
  instance text
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_typeof(archive->'references')='array' AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(archive->'references') ref(value)
   WHERE ref.value ? 'mapping' AND NOT coalesce(
     ref.value->'mapping'->>'organization_id'=tenant
     AND ref.value->'mapping'->>'instance_id'=instance
     AND length(ref.value->'mapping'->>'id')>0
     AND ref.value->>'kind' IN('task','project','milestone')
     AND length(ref.value->'mapping'->>(ref.value->>'kind' || '_id'))>0
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(source->'steps') step(value)
       WHERE step.value->>'id'=ref.value->'mapping'->>'step_id'
         AND step.value->>'organization_id'=tenant
         AND step.value->>'kind'=ref.value->>'kind'
         AND step.value->>'key'=ref.value->>'sourceKey'),false)),false)
$$;

--> statement-breakpoint
CREATE FUNCTION docket_guard_schedule_history_import () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; v work_template_invocation_revision; c work_template_blueprint_conversion;
BEGIN
 IF TG_OP='UPDATE' AND OLD.imported_history_receipt IS NOT NULL THEN
   IF NEW.imported_history_receipt IS DISTINCT FROM OLD.imported_history_receipt
      OR NEW.imported_history_receipt_hash IS DISTINCT FROM OLD.imported_history_receipt_hash THEN
     RAISE EXCEPTION 'Historical import receipts are immutable' USING ERRCODE='23514',CONSTRAINT='schedule_import_history_immutable';
   END IF;
   RETURN NEW;
 END IF;
 r:=NEW.imported_history_receipt;
 IF r IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Historical import needs an exact original receipt' USING ERRCODE='23514',CONSTRAINT='schedule_import_history_proof';
 END IF;
 SELECT * INTO v FROM work_template_invocation_revision
   WHERE id=r->'source'->>'revisionAlias' AND organization_id=NEW.organization_id
     AND invocation_id=NEW.blueprint_invocation_id;
 SELECT * INTO c FROM work_template_blueprint_conversion
   WHERE legacy_process_revision_id=v.id AND organization_id=v.organization_id AND invocation_id=v.invocation_id;
 IF NOT coalesce(
   (SELECT count(*) FROM jsonb_object_keys(r))=10
   AND r->>'kind'='imported_history' AND r->'revision'='1'::jsonb
   AND r->>'execution'='nonexecuting' AND r->>'continuation'='never'
   AND NEW.accepted_claim IS NULL AND NEW.legacy_instance_id IS NOT NULL
   AND (NEW.run_kind='historical' OR NEW.status::text IN('completed','canceled','skipped'))
   AND NEW.historical_archive IS NOT NULL
   AND NEW.historical_archive_hash=docket_schedule_fingerprint(NEW.historical_archive)
   AND NEW.imported_history_receipt_hash=docket_schedule_fingerprint(r)
   AND NEW.historical_archive->'instance'->>'id'=NEW.legacy_instance_id
   AND NEW.historical_archive->'instance'->>'organization_id'=NEW.organization_id
   AND NEW.historical_archive->'instance'->>'revision_id'=v.id
   AND v.origin='retained'
   AND NEW.historical_archive->'instance'->>'definition_id'=v.head_id
   AND (NEW.run_kind='historical' AND NEW.historical_archive->'instance'->>'occurrence_id' IS NULL
     OR NEW.run_kind='scheduled' AND NEW.historical_archive->'instance'->>'occurrence_id'=NEW.id)
   AND (NEW.series_id IS NULL OR EXISTS(SELECT 1 FROM recurrence_series_revision sr
     WHERE sr.id=NEW.series_revision_id AND sr.series_id=NEW.series_id AND sr.organization_id=NEW.organization_id
       AND sr.process_revision_id=v.id AND sr.blueprint_invocation_id=v.invocation_id))
   AND docket_schedule_history_references_proved(NEW.historical_archive,c.source_archive->'source',NEW.organization_id,NEW.legacy_instance_id)
   AND (docket_blueprint_retained_source(v.id)-'definition')=((c.source_archive->'source')-'definition')
   AND v.source_archive_hash=c.source_archive_hash
   AND c.source_archive_hash=docket_schedule_fingerprint(c.source_archive)
   AND v.original_source_fingerprint=c.source_fingerprint
   AND md5((c.source_archive->'source')::text)=v.original_source_fingerprint
   AND r->'source'=jsonb_build_object('kind','retained_source','revision',1,'revisionAlias',v.id,
     'invocationId',v.invocation_id,'originalFingerprint',v.original_source_fingerprint,'archiveHash',v.source_archive_hash)
   AND r->'identity'=jsonb_build_object('organizationId',NEW.organization_id,'occurrenceId',NEW.id,
     'seriesId',NEW.series_id,'seriesRevisionId',NEW.series_revision_id,'instanceAlias',NEW.legacy_instance_id,
     'externalOccurrenceKey',NEW.external_occurrence_key,'scheduledFor',NEW.scheduled_for::text,
     'originalScheduledFor',NEW.original_scheduled_for::text,'runKind',NEW.run_kind,'status',NEW.status::text)
   AND r->>'historicalArchiveHash'=NEW.historical_archive_hash
   AND r->'referenceCount'=to_jsonb(jsonb_array_length(NEW.historical_archive->'references'))
   AND jsonb_typeof(r->'reviewIssueCount')='number' AND r->>'reviewIssueCount' ~ '^(0|[1-9][0-9]*)$'
   AND r->'originalRootRefs' IS NOT DISTINCT FROM coalesce(NEW.blueprint_root_refs,'null'::jsonb),false) THEN
   RAISE EXCEPTION 'Historical import needs exact archived identity and source proof' USING ERRCODE='23514',CONSTRAINT='schedule_import_history_proof';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER schedule_history_import_guard
BEFORE INSERT OR UPDATE ON process_occurrence FOR EACH ROW
EXECUTE FUNCTION docket_guard_schedule_history_import ();
