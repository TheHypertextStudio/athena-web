-- Conditional alias references. This candidate is not journaled until its
-- compatible public authoring and runtime consumers pass their source-denial gate.
CREATE TABLE work_template_alias_reference_checkpoint (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enforced_at timestamptz,
  review_code text NOT NULL DEFAULT 'coverage_pending' CHECK (
    review_code IN (
      'coverage_pending',
      'identity_unproved',
      'head_unregistered',
      'revision_unregistered',
      'series_mismatch',
      'calendar_mismatch',
      'private_structure_unavailable',
      'enforced'
    )
  ),
  source_definition_count bigint NOT NULL DEFAULT 0 CHECK (source_definition_count >= 0),
  source_revision_count bigint NOT NULL DEFAULT 0 CHECK (source_revision_count >= 0),
  unresolved_head_count bigint NOT NULL DEFAULT 0 CHECK (unresolved_head_count >= 0),
  unresolved_revision_count bigint NOT NULL DEFAULT 0 CHECK (unresolved_revision_count >= 0),
  unresolved_series_count bigint NOT NULL DEFAULT 0 CHECK (unresolved_series_count >= 0),
  unresolved_calendar_count bigint NOT NULL DEFAULT 0 CHECK (unresolved_calendar_count >= 0),
  retained_instance_count bigint NOT NULL DEFAULT 0 CHECK (retained_instance_count >= 0),
  CONSTRAINT alias_reference_checkpoint_shape CHECK (
    (
      enforced_at IS NULL
      AND review_code <> 'enforced'
    )
    OR (
      enforced_at IS NOT NULL
      AND review_code = 'enforced'
      AND unresolved_head_count = 0
      AND unresolved_revision_count = 0
      AND unresolved_series_count = 0
      AND unresolved_calendar_count = 0
    )
  )
);

--> statement-breakpoint
ALTER TABLE work_template_alias_reference_checkpoint ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
INSERT INTO
  work_template_alias_reference_checkpoint (singleton)
VALUES
  (true);

--> statement-breakpoint
CREATE UNIQUE INDEX invocation_revision_alias_org_unique ON work_template_invocation_revision (id, organization_id);

--> statement-breakpoint
CREATE FUNCTION docket_guard_private_series_definition () RETURNS trigger LANGUAGE plpgsql
SET
  search_path = pg_catalog,
  public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.definition_id,NEW.organization_id) IS NOT DISTINCT FROM (OLD.definition_id,OLD.organization_id) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.recurrence_series_revision WHERE series_id=OLD.id) THEN
  RAISE EXCEPTION 'Schedule definition identity cannot change after revision registration' USING ERRCODE='23514',CONSTRAINT='schedule_private_definition_immutable';
 END IF;
 IF NEW.definition_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.work_template_invocation_head h WHERE h.id=NEW.definition_id AND h.organization_id=NEW.organization_id AND h.canonical_authoring_at IS NOT NULL AND h.identity_origin IS NOT NULL AND h.identity_review IS NULL AND h.published_invocation_id IS NOT NULL AND h.status='published' AND h.archived_at IS NULL) THEN
  RAISE EXCEPTION 'Schedule requires a current registered private definition' USING ERRCODE='23514',CONSTRAINT='schedule_private_definition_identity';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_guard_private_series_alias () RETURNS trigger LANGUAGE plpgsql
SET
  search_path = pg_catalog,
  public AS $$
DECLARE definition_key text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.organization_id,NEW.series_id,NEW.process_revision_id,NEW.blueprint_invocation_id)
   IS NOT DISTINCT FROM (OLD.organization_id,OLD.series_id,OLD.process_revision_id,OLD.blueprint_invocation_id) THEN RETURN NEW; END IF;
 SELECT definition_id INTO definition_key FROM public.recurrence_series WHERE id=NEW.series_id AND organization_id=NEW.organization_id;
 IF NOT FOUND OR (definition_key IS NULL AND NEW.process_revision_id IS NOT NULL)
  OR (definition_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.work_template_invocation_revision v
   WHERE v.id=NEW.process_revision_id AND v.organization_id=NEW.organization_id AND v.head_id=definition_key AND v.invocation_id=NEW.blueprint_invocation_id AND v.state='published')) THEN
  RAISE EXCEPTION 'Schedule revision requires its exact registered private alias' USING ERRCODE='23514',CONSTRAINT='schedule_private_alias_identity';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_guard_private_calendar_alias () RETURNS trigger LANGUAGE plpgsql
SET
  search_path = pg_catalog,
  public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.recurrence_series s WHERE s.id=NEW.series_id AND s.organization_id=NEW.organization_id AND s.definition_id=NEW.definition_id) THEN
  RAISE EXCEPTION 'Calendar binding requires its actual private series definition' USING ERRCODE='23514',CONSTRAINT='calendar_private_alias_identity';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_guard_normalized_private_authoring () RETURNS trigger LANGUAGE plpgsql
SET
  search_path = pg_catalog,
  public AS $$
BEGIN
 RAISE EXCEPTION 'Private definitions require canonical publication' USING ERRCODE='23514',CONSTRAINT='private_canonical_authoring_required';
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_private_alias_reference_schema_ready () RETURNS boolean LANGUAGE sql STABLE
SET
  search_path = pg_catalog,
  public AS $$
 SELECT
 EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conname='series_private_definition_tenant_fk' AND c.conrelid='public.recurrence_series'::regclass AND c.confrelid='public.work_template_invocation_head'::regclass AND c.contype='f' AND c.convalidated AND c.confdeltype='r' AND c.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.conrelid AND attname='definition_id'),(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.conrelid AND attname='organization_id')]::smallint[] AND c.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.confrelid AND attname='id'),(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.confrelid AND attname='organization_id')]::smallint[])
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conname='calendar_private_definition_tenant_fk' AND c.conrelid='public.calendar_process_binding'::regclass AND c.confrelid='public.work_template_invocation_head'::regclass AND c.contype='f' AND c.convalidated AND c.confdeltype='r' AND c.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.conrelid AND attname='definition_id'),(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.conrelid AND attname='organization_id')]::smallint[] AND c.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.confrelid AND attname='id'),(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.confrelid AND attname='organization_id')]::smallint[])
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conname='series_private_revision_tenant_fk' AND c.conrelid='public.recurrence_series_revision'::regclass AND c.confrelid='public.work_template_invocation_revision'::regclass AND c.contype='f' AND c.convalidated AND c.confdeltype='r' AND c.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.conrelid AND attname='process_revision_id'),(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.conrelid AND attname='organization_id')]::smallint[] AND c.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.confrelid AND attname='id'),(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=c.confrelid AND attname='organization_id')]::smallint[])
 AND NOT EXISTS(SELECT 1 FROM (VALUES('public.recurrence_series'::regclass,'private_series_definition_guard','public.docket_guard_private_series_definition()'::regprocedure,23,ARRAY['definition_id','organization_id']),('public.recurrence_series_revision'::regclass,'private_series_alias_guard','public.docket_guard_private_series_alias()'::regprocedure,23,ARRAY['blueprint_invocation_id','organization_id','process_revision_id','series_id']),('public.calendar_process_binding'::regclass,'private_calendar_alias_guard','public.docket_guard_private_calendar_alias()'::regprocedure,23,ARRAY['definition_id','organization_id','series_id']),('public.process_definition'::regclass,'private_definition_canonical_authoring','public.docket_guard_normalized_private_authoring()'::regprocedure,7,ARRAY[]::text[]),('public.process_revision'::regclass,'private_revision_canonical_authoring','public.docket_guard_normalized_private_authoring()'::regprocedure,7,ARRAY[]::text[])) required(relation_id,trigger_name,function_id,event_type,event_columns) WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=required.relation_id AND t.tgname=required.trigger_name AND t.tgfoid=required.function_id AND t.tgenabled='O' AND t.tgtype=required.event_type AND t.tgnargs=0 AND ARRAY(SELECT a.attname::text FROM pg_catalog.pg_attribute a WHERE a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr) ORDER BY a.attname)=required.event_columns))
$$;

--> statement-breakpoint
CREATE FUNCTION docket_private_structure_compatible () RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET
  search_path = pg_catalog,
  public AS $$
DECLARE compatible boolean;
BEGIN
 IF to_regprocedure('public.docket_private_structure_schema_ready()') IS NULL THEN RETURN false; END IF;
 -- Fixed schema-only verifier is supplied by the additive private structure
 -- migration. No caller SQL, body, status flag or candidate can grant readiness.
 EXECUTE 'SELECT public.docket_private_structure_schema_ready()' INTO compatible;
 RETURN compatible IS TRUE;
END $$;

--> statement-breakpoint
CREATE FUNCTION docket_private_alias_references_enforced () RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = pg_catalog,
  public AS $$
 SELECT EXISTS(SELECT 1 FROM public.work_template_alias_reference_checkpoint WHERE singleton AND enforced_at IS NOT NULL)
  AND public.docket_private_alias_reference_schema_ready() AND public.docket_private_structure_compatible()
$$;

--> statement-breakpoint
-- The ordinary role cannot write the owner-only checkpoint or invoke this DDL.
-- It is invoker-security: only the actual migrator has the required table locks,
-- table ownership and ALTER TABLE privileges. There is no caller identity input.
CREATE FUNCTION docket_enforce_private_alias_references () RETURNS jsonb LANGUAGE plpgsql
SET
  search_path = pg_catalog,
  public AS $$
DECLARE heads bigint; revisions bigint; series_count bigint; calendars bigint; definitions bigint; source_revisions bigint; instances bigint; reason text;
BEGIN
 LOCK TABLE public.process_definition,public.process_revision,public.work_template_invocation_head,public.work_template_invocation_revision,public.recurrence_series,public.recurrence_series_revision,public.calendar_process_binding IN SHARE ROW EXCLUSIVE MODE;
 IF public.docket_private_alias_references_enforced() THEN RETURN jsonb_build_object('enforced',true); END IF;
 SELECT count(*) INTO definitions FROM public.process_definition;
 SELECT count(*) INTO source_revisions FROM public.process_revision;
 SELECT count(*) INTO instances FROM public.process_instance;
 SELECT count(*) INTO heads FROM public.process_definition d LEFT JOIN public.work_template_invocation_head h ON h.id=d.id AND h.organization_id=d.organization_id
  WHERE h.id IS NULL OR h.canonical_authoring_at IS NULL OR h.identity_origin IS DISTINCT FROM 'retained' OR h.identity_review IS NOT NULL;
 SELECT count(*) INTO revisions FROM public.process_revision r WHERE NOT EXISTS(SELECT 1 FROM public.work_template_invocation_revision v WHERE v.id=r.id AND v.organization_id=r.organization_id AND v.head_id=r.definition_id AND v.origin='retained');
 SELECT count(*) INTO series_count FROM public.recurrence_series s WHERE
  (s.definition_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.work_template_invocation_head h WHERE h.id=s.definition_id AND h.organization_id=s.organization_id AND h.canonical_authoring_at IS NOT NULL AND h.identity_origin IS NOT NULL AND h.identity_review IS NULL))
  OR EXISTS(SELECT 1 FROM public.recurrence_series_revision r WHERE r.series_id=s.id AND (r.organization_id<>s.organization_id OR (s.definition_id IS NULL AND r.process_revision_id IS NOT NULL) OR (s.definition_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.work_template_invocation_revision v WHERE v.id=r.process_revision_id AND v.organization_id=r.organization_id AND v.head_id=s.definition_id AND v.invocation_id=r.blueprint_invocation_id AND v.state='published'))));
 SELECT count(*) INTO calendars FROM public.calendar_process_binding b WHERE NOT EXISTS(SELECT 1 FROM public.recurrence_series s JOIN public.work_template_invocation_head h ON h.id=s.definition_id AND h.organization_id=s.organization_id WHERE s.id=b.series_id AND s.organization_id=b.organization_id AND s.definition_id=b.definition_id AND h.canonical_authoring_at IS NOT NULL AND h.identity_origin IS NOT NULL AND h.identity_review IS NULL);
 reason:=CASE WHEN NOT public.docket_private_identity_namespace_ready() THEN 'identity_unproved' WHEN heads>0 THEN 'head_unregistered' WHEN revisions>0 THEN 'revision_unregistered' WHEN series_count>0 THEN 'series_mismatch' WHEN calendars>0 THEN 'calendar_mismatch' WHEN NOT public.docket_private_structure_compatible() THEN 'private_structure_unavailable' ELSE 'enforced' END;
 IF reason='enforced' THEN
  ALTER TABLE public.recurrence_series ADD CONSTRAINT series_private_definition_tenant_fk FOREIGN KEY(definition_id,organization_id) REFERENCES public.work_template_invocation_head(id,organization_id) ON DELETE RESTRICT;
  ALTER TABLE public.calendar_process_binding ADD CONSTRAINT calendar_private_definition_tenant_fk FOREIGN KEY(definition_id,organization_id) REFERENCES public.work_template_invocation_head(id,organization_id) ON DELETE RESTRICT;
  ALTER TABLE public.recurrence_series_revision ADD CONSTRAINT series_private_revision_tenant_fk FOREIGN KEY(process_revision_id,organization_id) REFERENCES public.work_template_invocation_revision(id,organization_id) ON DELETE RESTRICT;
  ALTER TABLE public.recurrence_series DROP CONSTRAINT recurrence_series_definition_id_process_definition_id_fk;
  ALTER TABLE public.calendar_process_binding DROP CONSTRAINT calendar_process_binding_definition_id_process_definition_id_fk;
  ALTER TABLE public.recurrence_series_revision DROP CONSTRAINT recurrence_series_revision_process_revision_id_process_revision;
  CREATE TRIGGER private_series_definition_guard BEFORE INSERT OR UPDATE OF organization_id,definition_id ON public.recurrence_series FOR EACH ROW EXECUTE FUNCTION public.docket_guard_private_series_definition();
  CREATE TRIGGER private_series_alias_guard BEFORE INSERT OR UPDATE OF organization_id,series_id,process_revision_id,blueprint_invocation_id ON public.recurrence_series_revision FOR EACH ROW EXECUTE FUNCTION public.docket_guard_private_series_alias();
  CREATE TRIGGER private_calendar_alias_guard BEFORE INSERT OR UPDATE OF organization_id,series_id,definition_id ON public.calendar_process_binding FOR EACH ROW EXECUTE FUNCTION public.docket_guard_private_calendar_alias();
  CREATE TRIGGER private_definition_canonical_authoring BEFORE INSERT ON public.process_definition FOR EACH ROW EXECUTE FUNCTION public.docket_guard_normalized_private_authoring();
  CREATE TRIGGER private_revision_canonical_authoring BEFORE INSERT ON public.process_revision FOR EACH ROW EXECUTE FUNCTION public.docket_guard_normalized_private_authoring();
 END IF;
 UPDATE public.work_template_alias_reference_checkpoint SET enforced_at=CASE WHEN reason='enforced' THEN clock_timestamp() ELSE NULL END,review_code=reason,source_definition_count=definitions,source_revision_count=source_revisions,unresolved_head_count=heads,unresolved_revision_count=revisions,unresolved_series_count=series_count,unresolved_calendar_count=calendars,retained_instance_count=instances WHERE singleton;
 RETURN jsonb_build_object('enforced',reason='enforced','reason',reason,'unresolvedHeads',heads,'unresolvedRevisions',revisions,'unresolvedSeries',series_count,'unresolvedCalendars',calendars,'retainedInstances',instances);
END $$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_enforce_private_alias_references ()
FROM
  PUBLIC;

--> statement-breakpoint
-- The first immutable version is returned before the definition's public pointer
-- is advanced. Its current authorized author may read that own/team-private
-- version without making unpublished bodies workspace-readable.
CREATE FUNCTION docket_template_author_publication_read (tenant text, template_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = pg_catalog,
  public AS $$
 SELECT public.docket_template_author(tenant,nullif(current_setting('docket.actor_id',true),''))
  AND public.docket_copy_definition_view(tenant,template_key,nullif(current_setting('docket.actor_id',true),''))
$$;

--> statement-breakpoint
CREATE POLICY work_type_version_author_read ON work_type_version FOR
SELECT
  TO public USING (
    public.docket_template_author_publication_read (organization_id, work_type_id)
  );
