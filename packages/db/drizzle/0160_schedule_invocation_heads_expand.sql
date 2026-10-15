-- Canonical schedule expansion; source retirement requires a separate explicit cutover gate.
CREATE UNIQUE INDEX "schedule_actor_identity_unique" ON "actor" ("id", "organization_id");
--> statement-breakpoint
CREATE TABLE "work_template_invocation_head" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "created_by" text REFERENCES "actor"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "archived_at" timestamp,
  "owner_actor_id" text REFERENCES "actor"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'draft',
  "revision" integer NOT NULL DEFAULT 1,
  "draft_invocation_id" text,
  "published_invocation_id" text,
  CONSTRAINT "invocation_head_name" CHECK (length(btrim(name)) > 0),
  CONSTRAINT "invocation_head_revision" CHECK (revision > 0),
  CONSTRAINT "invocation_head_status" CHECK (status IN ('draft','published','archived') AND (status <> 'published' OR published_invocation_id IS NOT NULL)),
  CONSTRAINT "invocation_head_owner_tenant_fk" FOREIGN KEY (owner_actor_id, organization_id) REFERENCES actor(id, organization_id),
  CONSTRAINT "invocation_head_draft_tenant_fk" FOREIGN KEY (draft_invocation_id, organization_id) REFERENCES work_template_blueprint_invocation(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT "invocation_head_published_tenant_fk" FOREIGN KEY (published_invocation_id, organization_id) REFERENCES work_template_blueprint_invocation(id, organization_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invocation_head_identity_unique" ON "work_template_invocation_head" ("id", "organization_id");
--> statement-breakpoint
CREATE INDEX "invocation_head_owner_idx" ON "work_template_invocation_head" ("organization_id", "owner_actor_id", "status");
--> statement-breakpoint
CREATE FUNCTION docket_validate_invocation_head() RETURNS trigger LANGUAGE plpgsql AS $$
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
      OR (publication->>'kind'='forest' AND publication->>'revision'='1' AND publication->>'state'='published')), false) THEN
      RAISE EXCEPTION 'Published head requires an executable immutable document' USING ERRCODE='23514', CONSTRAINT='invocation_head_publication';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "invocation_head_guard" BEFORE INSERT OR UPDATE ON "work_template_invocation_head"
  FOR EACH ROW EXECUTE FUNCTION docket_validate_invocation_head();
--> statement-breakpoint
ALTER TABLE "work_template_invocation_head" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "invocation_head_private" ON "work_template_invocation_head" FOR ALL TO public
USING (organization_id=nullif(current_setting('docket.organization_id',true),'') AND EXISTS(
  SELECT 1 FROM actor a LEFT JOIN role r ON r.id=a.role_id AND r.organization_id=a.organization_id
  WHERE a.id=nullif(current_setting('docket.actor_id',true),'') AND a.organization_id=work_template_invocation_head.organization_id
    AND a.status='active' AND a.archived_at IS NULL
    AND (a.id=work_template_invocation_head.owner_actor_id OR r.base_capability='manage' OR r.capabilities @> '["manage"]'::jsonb)))
WITH CHECK (organization_id=nullif(current_setting('docket.organization_id',true),'') AND EXISTS(
  SELECT 1 FROM actor a LEFT JOIN role r ON r.id=a.role_id AND r.organization_id=a.organization_id
  WHERE a.id=nullif(current_setting('docket.actor_id',true),'') AND a.organization_id=work_template_invocation_head.organization_id
    AND a.status='active' AND a.archived_at IS NULL
    AND (a.id=work_template_invocation_head.owner_actor_id OR r.base_capability='manage' OR r.capabilities @> '["manage"]'::jsonb)));
--> statement-breakpoint
ALTER TYPE process_occurrence_status ADD VALUE IF NOT EXISTS 'failed';
--> statement-breakpoint
CREATE UNIQUE INDEX schedule_program_identity_unique ON program(id,organization_id);
--> statement-breakpoint
CREATE UNIQUE INDEX schedule_series_identity_unique ON recurrence_series(id,organization_id);
--> statement-breakpoint
CREATE UNIQUE INDEX schedule_revision_identity_unique ON recurrence_series_revision(id,series_id,organization_id);
--> statement-breakpoint
ALTER TABLE recurrence_series ADD COLUMN owner_program_id text;
--> statement-breakpoint
ALTER TABLE recurrence_series ALTER COLUMN definition_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE recurrence_series ADD CONSTRAINT schedule_series_program_tenant_fk FOREIGN KEY(owner_program_id,organization_id) REFERENCES program(id,organization_id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE recurrence_series_revision ADD COLUMN schedule_draft jsonb;
--> statement-breakpoint
ALTER TABLE recurrence_series_revision ADD COLUMN authoring_fallback jsonb;
--> statement-breakpoint
ALTER TABLE recurrence_series_revision ALTER COLUMN process_revision_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE recurrence_series_revision ADD CONSTRAINT schedule_revision_series_tenant_fk FOREIGN KEY(series_id,organization_id) REFERENCES recurrence_series(id,organization_id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE SEQUENCE schedule_acceptance_ordinal;
--> statement-breakpoint
ALTER TABLE process_occurrence ALTER COLUMN series_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE process_occurrence ALTER COLUMN series_revision_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN run_kind text NOT NULL DEFAULT 'scheduled';
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN legacy_instance_id text;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN accepted_claim jsonb;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN accepted_at timestamptz;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN acceptance_ordinal bigint;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN attempt integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN failed_at timestamptz;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN failure_code text;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN retry_available_at timestamptz;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN completed_at timestamptz;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN historical_archive jsonb;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD COLUMN historical_archive_hash text;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD CONSTRAINT schedule_occurrence_revision_tenant_fk FOREIGN KEY(series_revision_id,series_id,organization_id) REFERENCES recurrence_series_revision(id,series_id,organization_id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE process_occurrence ADD CONSTRAINT schedule_occurrence_run_shape CHECK (
  (run_kind='scheduled' AND series_id IS NOT NULL AND series_revision_id IS NOT NULL)
  OR (run_kind='historical' AND series_id IS NULL AND series_revision_id IS NULL AND legacy_instance_id IS NOT NULL
    AND status::text IN('completed','canceled','failed','needs_resolution') AND external_occurrence_key IS NULL
    AND accepted_claim IS NULL AND retry_available_at IS NULL));
--> statement-breakpoint
ALTER TABLE process_occurrence ADD CONSTRAINT schedule_occurrence_attempt CHECK (attempt>=0);
--> statement-breakpoint
ALTER TABLE process_occurrence ADD CONSTRAINT schedule_occurrence_claim_shape CHECK (
  (accepted_claim IS NULL AND accepted_at IS NULL AND acceptance_ordinal IS NULL)
  OR (accepted_claim IS NOT NULL AND accepted_at IS NOT NULL AND acceptance_ordinal>0));
--> statement-breakpoint
CREATE UNIQUE INDEX schedule_occurrence_legacy_instance_unique ON process_occurrence(organization_id,legacy_instance_id);
--> statement-breakpoint
CREATE UNIQUE INDEX schedule_occurrence_acceptance_unique ON process_occurrence(acceptance_ordinal);
--> statement-breakpoint
ALTER TABLE work_template_blueprint_conversion ADD COLUMN source_archive jsonb;
--> statement-breakpoint
ALTER TABLE work_template_blueprint_conversion ADD COLUMN source_archive_hash text;
--> statement-breakpoint
ALTER TABLE work_template_blueprint_conversion ADD COLUMN source_archive_hash_version integer;
--> statement-breakpoint
CREATE FUNCTION docket_schedule_keys(value jsonb,keys text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(value)='object' AND (SELECT count(*)=cardinality(keys) AND bool_and(k=ANY(keys)) FROM jsonb_object_keys(value) k)
$$;
--> statement-breakpoint
CREATE FUNCTION docket_validate_schedule_roots(roots jsonb,tenant text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE root jsonb; item jsonb; selected jsonb; total integer:=0;
BEGIN
 IF jsonb_typeof(roots)<>'array' OR jsonb_array_length(roots) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'Invalid schedule roots' USING ERRCODE='23514',CONSTRAINT='schedule_claim_roots'; END IF;
 IF (SELECT count(DISTINCT r->>'key')<>count(*) FROM jsonb_array_elements(roots) r) THEN
  RAISE EXCEPTION 'Duplicate schedule roots' USING ERRCODE='23514',CONSTRAINT='schedule_claim_roots'; END IF;
 FOR root IN SELECT * FROM jsonb_array_elements(roots) LOOP
  IF NOT coalesce(docket_schedule_keys(root,ARRAY['key','kind','workTypeId','versionId','resolvedManifest','optionalChoices','selectedPaths'])
   AND root->>'kind' IN('task','project') AND root->>'key' ~ '^[a-z][a-z0-9_-]{0,63}$'
   AND jsonb_typeof(root->'resolvedManifest')='array' AND jsonb_typeof(root->'selectedPaths')='array'
   AND jsonb_typeof(root->'optionalChoices')='array',false) THEN
   RAISE EXCEPTION 'Invalid schedule root' USING ERRCODE='23514',CONSTRAINT='schedule_claim_roots'; END IF;
  total:=total+jsonb_array_length(root->'selectedPaths');
  IF jsonb_array_length(root->'selectedPaths')<1 OR jsonb_array_length(root->'resolvedManifest')<1
   OR (SELECT count(DISTINCT r->'path')<>count(*) FROM jsonb_array_elements(root->'selectedPaths') r)
   OR (SELECT count(DISTINCT r->'path')<>count(*) FROM jsonb_array_elements(root->'resolvedManifest') r)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(root->'selectedPaths') r WHERE r->'path'='[]'::jsonb AND r->>'kind'=root->>'kind')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(root->'resolvedManifest') r WHERE r->'path'='[]'::jsonb AND r->>'workTypeId'=root->>'workTypeId' AND r->>'versionId'=root->>'versionId') THEN
   RAISE EXCEPTION 'Incomplete schedule closure' USING ERRCODE='23514',CONSTRAINT='schedule_claim_closure'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(root->'resolvedManifest') LOOP
   IF NOT docket_schedule_keys(item,ARRAY['path','workTypeId','versionId']) OR jsonb_typeof(item->'path')<>'array'
    OR NOT EXISTS(SELECT 1 FROM work_type_version v WHERE v.id=item->>'versionId' AND v.work_type_id=item->>'workTypeId' AND v.organization_id=tenant)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(root->'selectedPaths') p WHERE p->'path'=item->'path' AND p->>'kind'<>'milestone') THEN
    RAISE EXCEPTION 'Foreign or unselected schedule publication' USING ERRCODE='23514',CONSTRAINT='schedule_claim_publication'; END IF;
  END LOOP;
  FOR selected IN SELECT * FROM jsonb_array_elements(root->'selectedPaths') LOOP
   IF NOT docket_schedule_keys(selected,ARRAY['path','kind']) OR jsonb_typeof(selected->'path')<>'array'
    OR selected->>'kind' NOT IN('task','project','program','milestone')
    OR (jsonb_array_length(selected->'path')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(root->'selectedPaths') p WHERE p->'path'=(selected->'path')-(jsonb_array_length(selected->'path')-1)))
    OR (selected->>'kind'<>'milestone' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(root->'resolvedManifest') p WHERE p->'path'=selected->'path')) THEN
    RAISE EXCEPTION 'Incomplete schedule selection' USING ERRCODE='23514',CONSTRAINT='schedule_claim_selection'; END IF;
  END LOOP;
 END LOOP;
 IF total>500 THEN RAISE EXCEPTION 'Schedule exceeds 500 work rows' USING ERRCODE='23514',CONSTRAINT='schedule_claim_budget'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_schedule_series_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.owner_program_id IS DISTINCT FROM OLD.owner_program_id OR NEW.organization_id<>OLD.organization_id) THEN
  RAISE EXCEPTION 'Schedule ownership is immutable' USING ERRCODE='23514',CONSTRAINT='schedule_owner_immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER schedule_series_guard BEFORE UPDATE ON recurrence_series FOR EACH ROW EXECUTE FUNCTION docket_schedule_series_guard();
--> statement-breakpoint
CREATE FUNCTION docket_schedule_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE draft jsonb; source_id text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.accepted_claim IS NOT NULL AND (NEW.accepted_claim IS DISTINCT FROM OLD.accepted_claim OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.acceptance_ordinal IS DISTINCT FROM OLD.acceptance_ordinal OR NEW.series_revision_id IS DISTINCT FROM OLD.series_revision_id OR NEW.blueprint_invocation_id IS DISTINCT FROM OLD.blueprint_invocation_id) THEN
   RAISE EXCEPTION 'Accepted schedule claim is immutable' USING ERRCODE='23514',CONSTRAINT='schedule_claim_immutable'; END IF;
  IF NEW.attempt<OLD.attempt OR NEW.attempt>OLD.attempt+1 THEN
   RAISE EXCEPTION 'Schedule attempt must advance one at a time' USING ERRCODE='23514',CONSTRAINT='schedule_attempt_monotonic'; END IF;
  IF OLD.historical_archive IS NOT NULL AND (NEW.historical_archive IS DISTINCT FROM OLD.historical_archive OR NEW.historical_archive_hash IS DISTINCT FROM OLD.historical_archive_hash OR NEW.legacy_instance_id IS DISTINCT FROM OLD.legacy_instance_id OR NEW.run_kind<>OLD.run_kind) THEN
   RAISE EXCEPTION 'Historical receipt is immutable' USING ERRCODE='23514',CONSTRAINT='schedule_history_immutable'; END IF;
 END IF;
 IF NEW.historical_archive IS NOT NULL AND (TG_OP='INSERT' OR OLD.historical_archive IS NULL) THEN
  IF NOT docket_schedule_keys(NEW.historical_archive,ARRAY['revision','instance','references']) OR NEW.historical_archive->>'revision'<>'1'
   OR jsonb_typeof(NEW.historical_archive->'references')<>'array' OR NEW.historical_archive_hash IS DISTINCT FROM docket_schedule_fingerprint(NEW.historical_archive) THEN
   RAISE EXCEPTION 'Historical archive integrity is invalid' USING ERRCODE='23514',CONSTRAINT='schedule_history_integrity'; END IF;
 END IF;
 IF NEW.accepted_claim IS NOT NULL AND (TG_OP='INSERT' OR OLD.accepted_claim IS NULL) THEN
  SELECT schedule_draft,blueprint_invocation_id INTO draft,source_id FROM recurrence_series_revision
   WHERE id=NEW.series_revision_id AND series_id=NEW.series_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF draft IS NULL OR NOT coalesce(docket_schedule_keys(NEW.accepted_claim,ARRAY['kind','revision','sourceInvocationId','seriesRevisionId','runDate','timezone','draftFingerprint','roots'])
   AND NEW.accepted_claim->>'kind'='schedule' AND NEW.accepted_claim->>'revision'='1'
   AND NEW.accepted_claim->>'seriesRevisionId'=NEW.series_revision_id
   AND (NEW.accepted_claim->>'sourceInvocationId') IS NOT DISTINCT FROM source_id
   AND NEW.blueprint_invocation_id IS NOT DISTINCT FROM source_id
   AND NEW.accepted_claim->>'runDate' ~ '^\d{4}-\d{2}-\d{2}$'
   AND NEW.accepted_claim->>'draftFingerprint'=docket_schedule_fingerprint(draft),false) THEN
   RAISE EXCEPTION 'Schedule claim does not match persisted revision' USING ERRCODE='23514',CONSTRAINT='schedule_claim_registration'; END IF;
  PERFORM docket_validate_schedule_roots(NEW.accepted_claim->'roots',NEW.organization_id);
  NEW.acceptance_ordinal:=nextval('schedule_acceptance_ordinal');
  NEW.accepted_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER schedule_claim_guard BEFORE INSERT OR UPDATE ON process_occurrence FOR EACH ROW EXECUTE FUNCTION docket_schedule_claim_guard();
--> statement-breakpoint
CREATE FUNCTION docket_schedule_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fallback jsonb; draft_root jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.schedule_draft IS NOT NULL AND NEW.schedule_draft IS DISTINCT FROM OLD.schedule_draft THEN
  RAISE EXCEPTION 'Canonical schedule draft is immutable; append a revision' USING ERRCODE='23514',CONSTRAINT='schedule_draft_immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.authoring_fallback IS NOT NULL AND NEW.authoring_fallback IS DISTINCT FROM OLD.authoring_fallback THEN
  RAISE EXCEPTION 'Authoring fallback is immutable' USING ERRCODE='23514',CONSTRAINT='schedule_fallback_immutable'; END IF;
 IF NEW.schedule_draft IS NOT NULL AND NOT coalesce(NEW.schedule_draft->>'revision'='1' AND (
  (NEW.schedule_draft->>'kind'='schedule' AND docket_schedule_keys(NEW.schedule_draft,ARRAY['kind','revision','template','titlePattern','timezone','root','stepOverrides','optionalChoices'])
   AND NEW.schedule_draft->'template'->>'targetType'=NEW.schedule_draft->'root'->>'kind')
  OR (NEW.schedule_draft->>'kind'='forest' AND docket_schedule_keys(NEW.schedule_draft,ARRAY['kind','revision','state','roots','dependencies','timing'])
   AND NEW.schedule_draft->>'state' IN('published','pending_draft') AND jsonb_typeof(NEW.schedule_draft->'roots')='array'
   AND jsonb_array_length(NEW.schedule_draft->'roots') BETWEEN 1 AND 500)),false) THEN
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
CREATE TRIGGER schedule_revision_guard BEFORE INSERT OR UPDATE ON recurrence_series_revision FOR EACH ROW EXECUTE FUNCTION docket_schedule_revision_guard();
--> statement-breakpoint
CREATE FUNCTION docket_schedule_conversion_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.source_archive IS NULL AND NEW.source_archive IS NOT NULL
  AND (to_jsonb(NEW)-ARRAY['source_archive','source_archive_hash','source_archive_hash_version'])=(to_jsonb(OLD)-ARRAY['source_archive','source_archive_hash','source_archive_hash_version'])
  AND NEW.source_archive->>'revision'='1' AND NEW.source_archive_hash_version=1
  AND NEW.source_archive_hash=docket_schedule_fingerprint(NEW.source_archive) THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organization WHERE id=OLD.organization_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Source archive and original conversion facts are immutable' USING ERRCODE='23514',CONSTRAINT='schedule_source_archive_immutable';
END $$;
--> statement-breakpoint
DROP TRIGGER blueprint_conversion_immutable ON work_template_blueprint_conversion;
--> statement-breakpoint
CREATE TRIGGER blueprint_conversion_immutable BEFORE UPDATE OR DELETE ON work_template_blueprint_conversion FOR EACH ROW EXECUTE FUNCTION docket_schedule_conversion_archive_guard();
--> statement-breakpoint

--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_blueprint_invocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root jsonb; entry jsonb; payload jsonb:=NEW.manifest; context_row jsonb; field_name text; table_name text; reference_id text; present boolean;
BEGIN
  IF NEW.owner_actor_id IS NOT NULL AND NOT EXISTS(select 1 from actor where id=NEW.owner_actor_id and organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invocation owner is outside its workspace' USING ERRCODE='23514',CONSTRAINT='blueprint_invocation'; END IF;
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

--> statement-breakpoint
CREATE FUNCTION docket_schedule_canonical_json(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||docket_schedule_canonical_json(item),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(value) entry(key,item);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(docket_schedule_canonical_json(item),',' ORDER BY position),'')||']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY entry(item,position);
 ELSE result:=value::text;
 END CASE;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_schedule_fingerprint(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT 'sha256:'||encode(sha256(convert_to(docket_schedule_canonical_json(value),'UTF8')),'hex')
$$;
--> statement-breakpoint

--> statement-breakpoint
CREATE FUNCTION docket_validate_schedule_selected_work(selected_rows jsonb,manifest jsonb,root_ref jsonb,invocation_manifest jsonb,tenant text,occurrence_id text) RETURNS void LANGUAGE plpgsql AS $$
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
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(manifest) accepted(value) WHERE accepted.value->'path'='[]'::jsonb AND accepted.value->>'workTypeId'=stored_row->>'work_type_id' AND accepted.value->>'versionId'=stored_row->>'work_type_version_id') THEN
        RAISE EXCEPTION 'Schedule root differs from its accepted publication' USING ERRCODE='23514',CONSTRAINT='schedule_actual_root_publication'; END IF;
      CONTINUE;
    END IF;
    SELECT coalesce(jsonb_agg(path_part.value ORDER BY path_part.ordinal),'[]'::jsonb) INTO scope_path FROM jsonb_array_elements(selected_row->'path') WITH ORDINALITY AS path_part(value,ordinal) WHERE path_part.ordinal<jsonb_array_length(selected_row->'path');
    SELECT resolution_row.value->>'versionId' INTO scope_version FROM jsonb_array_elements(manifest) AS resolution_row(value) WHERE resolution_row.value->'path'=scope_path;
    SELECT projection.* INTO source_projection FROM blueprint_step projection WHERE projection.organization_id=tenant AND projection.version_id=scope_version AND projection.key=selected_row->'path'->>-1;
    IF source_projection.id IS NULL OR source_projection.kind::text IS DISTINCT FROM selected_row->>'kind' THEN RAISE EXCEPTION 'Retained selected work has no original source projection' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    parent_path:=CASE WHEN source_projection.parent_step_key IS NULL THEN scope_path ELSE scope_path || jsonb_build_array(source_projection.parent_step_key) END;
    SELECT selection_row.value INTO parent_selection FROM jsonb_array_elements(selected_rows) AS selection_row(value) WHERE selection_row.value->'path'=parent_path;
    IF parent_selection IS NULL THEN RAISE EXCEPTION 'Retained selected parent is missing' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
    IF (stored_row->>'blueprint_step_id' IS DISTINCT FROM source_projection.id OR stored_row->>'blueprint_source_version_id' IS DISTINCT FROM scope_version OR to_jsonb(ARRAY(SELECT path_part.value FROM jsonb_array_elements_text(selected_row->'path') AS path_part(value))) IS DISTINCT FROM stored_row->'blueprint_path' OR stored_row->>'blueprint_parent_kind' IS DISTINCT FROM parent_selection->>'kind' OR stored_row->>'blueprint_parent_id' IS DISTINCT FROM parent_selection->>'id') THEN RAISE EXCEPTION 'Retained selected work differs from its immutable origin' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
  END LOOP;
  IF EXISTS(select 1 from jsonb_array_elements(manifest) AS resolution_row(value) where not exists(select 1 from jsonb_array_elements(selected_rows) AS selection_row(value) where selection_row.value->'path'=resolution_row.value->'path')) THEN RAISE EXCEPTION 'Retained accepted identity has no selected work' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
  IF NOT EXISTS(select 1 from jsonb_array_elements(selected_rows) AS selection_row(value) where selection_row.value->'path'='[]'::jsonb) OR (select count(distinct selection_row.value->'path') from jsonb_array_elements(selected_rows) AS selection_row(value))<>jsonb_array_length(selected_rows) OR (select count(distinct jsonb_build_array(selection_row.value->>'kind',selection_row.value->>'id')) from jsonb_array_elements(selected_rows) AS selection_row(value))<>jsonb_array_length(selected_rows) THEN RAISE EXCEPTION 'Retained selected paths and identities must be unique' USING ERRCODE='23514',CONSTRAINT='retained_selected_work'; END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_blueprint_occurrence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_ref jsonb; previous_root jsonb; invocation_manifest jsonb; original_root jsonb; present boolean; resolution_count integer:=0; selected_count integer:=0;
BEGIN
  IF NEW.accepted_claim IS NOT NULL THEN
    IF TG_OP='UPDATE' AND OLD.blueprint_applied_at IS NOT NULL AND NEW.blueprint_root_refs IS DISTINCT FROM OLD.blueprint_root_refs THEN
      RAISE EXCEPTION 'Applied schedule roots are immutable' USING ERRCODE='23514',CONSTRAINT='schedule_actual_roots_immutable'; END IF;
    IF NEW.blueprint_root_refs IS NULL THEN RETURN NEW; END IF;
    IF jsonb_typeof(NEW.blueprint_root_refs)<>'array' OR jsonb_array_length(NEW.blueprint_root_refs)>500 THEN
      RAISE EXCEPTION 'Invalid schedule actual roots' USING ERRCODE='23514',CONSTRAINT='schedule_actual_roots'; END IF;
    FOR root_ref IN SELECT * FROM jsonb_array_elements(NEW.blueprint_root_refs) LOOP
      SELECT accepted.value INTO original_root FROM jsonb_array_elements(NEW.accepted_claim->'roots') accepted(value) WHERE accepted.value->>'key'=root_ref->>'key';
      IF original_root IS NULL OR root_ref->>'kind' IS DISTINCT FROM original_root->>'kind' OR root_ref->'resolvedManifest' IS DISTINCT FROM original_root->'resolvedManifest'
       OR NOT docket_schedule_keys(root_ref,ARRAY['key','kind','id','resolvedManifest','selectedWork'])
       OR (SELECT jsonb_agg(jsonb_build_object('path',w->'path','kind',w->'kind') ORDER BY w->'path') FROM jsonb_array_elements(root_ref->'selectedWork') w) IS DISTINCT FROM (SELECT jsonb_agg(w ORDER BY w->'path') FROM jsonb_array_elements(original_root->'selectedPaths') w) THEN
        RAISE EXCEPTION 'Actual root differs from accepted claim' USING ERRCODE='23514',CONSTRAINT='schedule_actual_roots'; END IF;
      IF TG_OP='INSERT' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(OLD.blueprint_root_refs,'[]'::jsonb)) previous(value) WHERE previous.value=root_ref) THEN
        PERFORM docket_validate_schedule_selected_work(root_ref->'selectedWork',root_ref->'resolvedManifest',root_ref,'{}'::jsonb,NEW.organization_id,NEW.id);
      END IF;
    END LOOP;
    IF (SELECT count(DISTINCT r->>'key')<>count(*) FROM jsonb_array_elements(NEW.blueprint_root_refs) r) THEN
      RAISE EXCEPTION 'Duplicate schedule actual root' USING ERRCODE='23514',CONSTRAINT='schedule_actual_roots'; END IF;
    RETURN NEW;
  END IF;
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_guard_retained_occurrence_applied() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accepted_claim IS NOT NULL THEN
    IF TG_OP='UPDATE' AND OLD.blueprint_applied_at IS NOT NULL AND NEW.blueprint_applied_at IS DISTINCT FROM OLD.blueprint_applied_at THEN
      RAISE EXCEPTION 'Accepted schedule application is immutable' USING ERRCODE='23514',CONSTRAINT='schedule_applied_immutable'; END IF;
    IF NEW.blueprint_applied_at IS NOT NULL AND (NEW.blueprint_root_refs IS NULL OR jsonb_array_length(NEW.blueprint_root_refs)<>jsonb_array_length(NEW.accepted_claim->'roots')) THEN
      RAISE EXCEPTION 'Applied schedule requires every accepted root' USING ERRCODE='23514',CONSTRAINT='schedule_applied_complete'; END IF;
    RETURN NEW;
  END IF;
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

--> statement-breakpoint
ALTER TABLE recurrence_series_revision ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY schedule_revision_private ON recurrence_series_revision FOR ALL TO public
USING (organization_id=nullif(current_setting('docket.organization_id',true),'') AND EXISTS(SELECT 1 FROM actor a LEFT JOIN role r ON r.id=a.role_id AND r.organization_id=a.organization_id WHERE a.id=nullif(current_setting('docket.actor_id',true),'') AND a.organization_id=recurrence_series_revision.organization_id AND a.status='active' AND a.archived_at IS NULL AND (a.id=recurrence_series_revision.created_by OR r.base_capability='manage' OR r.capabilities @> '["manage"]'::jsonb)))
WITH CHECK (organization_id=nullif(current_setting('docket.organization_id',true),'') AND EXISTS(SELECT 1 FROM actor a LEFT JOIN role r ON r.id=a.role_id AND r.organization_id=a.organization_id WHERE a.id=nullif(current_setting('docket.actor_id',true),'') AND a.organization_id=recurrence_series_revision.organization_id AND a.status='active' AND a.archived_at IS NULL AND (a.id=recurrence_series_revision.created_by OR r.base_capability='manage' OR r.capabilities @> '["manage"]'::jsonb)));
--> statement-breakpoint

--> statement-breakpoint
CREATE FUNCTION docket_validate_schedule_template(selection jsonb,tenant text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT coalesce(docket_schedule_keys(selection,ARRAY['workTypeId','selection','targetType']) AND selection->>'targetType' IN('task','project')
  AND EXISTS(SELECT 1 FROM template t WHERE t.id=selection->>'workTypeId' AND t.organization_id=tenant AND t.target_type::text=selection->>'targetType')
  AND ((selection->'selection'->>'kind'='latest' AND docket_schedule_keys(selection->'selection',ARRAY['kind']))
    OR (selection->'selection'->>'kind'='pinned' AND docket_schedule_keys(selection->'selection',ARRAY['kind','workTypeVersionId'])
      AND EXISTS(SELECT 1 FROM work_type_version v WHERE v.id=selection->'selection'->>'workTypeVersionId' AND v.work_type_id=selection->>'workTypeId' AND v.organization_id=tenant))),false) THEN
  RAISE EXCEPTION 'Schedule template selection is outside its workspace or kind' USING ERRCODE='23514',CONSTRAINT='schedule_template_selection'; END IF;
END $$;
--> statement-breakpoint
