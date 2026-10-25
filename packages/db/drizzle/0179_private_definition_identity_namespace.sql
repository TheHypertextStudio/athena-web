-- Reserve source identities in bounded checkpoint batches before allowing a
-- source-independent authored head. This migration grants no execution authority.
ALTER TABLE work_template_invocation_head
ADD COLUMN identity_origin text;

--> statement-breakpoint
ALTER TABLE work_template_invocation_head
ADD COLUMN identity_review text;

--> statement-breakpoint
ALTER TABLE work_template_invocation_head
ALTER COLUMN identity_origin
SET DEFAULT 'authored';

--> statement-breakpoint
ALTER TABLE work_template_invocation_head
ADD CONSTRAINT invocation_head_identity_origin_shape CHECK (
  (
    identity_origin IN ('retained', 'authored')
    AND identity_review IS NULL
  )
  OR (
    identity_origin IS NULL
    AND identity_review IN ('identity_collision', 'retained_source_missing')
  )
  OR (
    identity_origin IS NULL
    AND identity_review IS NULL
  )
);

--> statement-breakpoint
CREATE TABLE work_template_identity_namespace (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  ready_at timestamptz,
  review_code text DEFAULT 'reservation_pending' CHECK (
    review_code IN ('reservation_pending', 'identity_collision')
  ),
  unreserved_source_count integer CHECK (unreserved_source_count >= 0),
  reserved_source_count integer,
  coverage_hash text,
  CONSTRAINT identity_namespace_receipt_shape CHECK (
    (
      ready_at IS NULL
      AND reserved_source_count IS NULL
      AND coverage_hash IS NULL
      AND review_code IS NOT NULL
    )
    OR (
      ready_at IS NOT NULL
      AND reserved_source_count >= 0
      AND coverage_hash ~ '^sha256:[a-f0-9]{64}$'
      AND review_code IS NULL
      AND unreserved_source_count = 0
    )
  )
);

--> statement-breakpoint
ALTER TABLE work_template_identity_namespace ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
INSERT INTO
  work_template_identity_namespace (singleton)
VALUES
  (true);

--> statement-breakpoint
-- This definer reads one owner-only boolean receipt. It neither reads source
-- data nor accepts identifiers; ordinary table grants cannot write its RLS row.
CREATE FUNCTION docket_private_identity_namespace_ready () RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = pg_catalog,
  public AS $$
 SELECT EXISTS(SELECT 1 FROM public.work_template_identity_namespace WHERE singleton AND ready_at IS NOT NULL)
$$;

--> statement-breakpoint
CREATE FUNCTION docket_invocation_head_identity_origin (head_key text, tenant text) RETURNS text LANGUAGE sql STABLE
SET
  search_path = pg_catalog,
  public AS $$
 SELECT CASE
 WHEN EXISTS(SELECT 1 FROM public.process_definition WHERE id=head_key AND organization_id=tenant) THEN
  CASE WHEN EXISTS(SELECT 1 FROM public.work_template_invocation_revision WHERE head_id=head_key AND organization_id=tenant AND origin='authored')
   AND NOT EXISTS(SELECT 1 FROM public.work_template_invocation_revision WHERE head_id=head_key AND organization_id=tenant AND origin='retained') THEN NULL ELSE 'retained' END
 WHEN EXISTS(SELECT 1 FROM public.work_template_invocation_revision WHERE head_id=head_key AND organization_id=tenant AND origin='retained') THEN NULL
 ELSE 'authored' END
$$;

--> statement-breakpoint
CREATE FUNCTION docket_invocation_head_identity_review (head_key text, tenant text) RETURNS text LANGUAGE sql STABLE
SET
  search_path = pg_catalog,
  public AS $$
 SELECT CASE WHEN public.docket_invocation_head_identity_origin(head_key,tenant) IS NOT NULL THEN NULL
 WHEN EXISTS(SELECT 1 FROM public.process_definition WHERE id=head_key AND organization_id=tenant) THEN 'identity_collision'
 ELSE 'retained_source_missing' END
$$;

--> statement-breakpoint
CREATE FUNCTION docket_guard_invocation_head_identity_origin () RETURNS trigger LANGUAGE plpgsql
SET
  search_path = pg_catalog,
  public AS $$
DECLARE source public.process_definition; expected text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.organization WHERE id=OLD.organization_id) THEN RETURN OLD; END IF;
  IF OLD.identity_origin IS DISTINCT FROM 'authored' AND EXISTS(SELECT 1 FROM public.process_definition WHERE id=OLD.id AND organization_id=OLD.organization_id) THEN
   RAISE EXCEPTION 'Original identity reservation cannot be deleted' USING ERRCODE='23514',CONSTRAINT='invocation_head_identity_reservation_retention';
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.identity_origin IS NOT NULL THEN
   IF NEW.identity_origin IS DISTINCT FROM OLD.identity_origin OR NEW.identity_review IS NOT NULL THEN
    RAISE EXCEPTION 'Private identity origin is immutable' USING ERRCODE='23514',CONSTRAINT='invocation_head_identity_origin_immutable';
   END IF;
  ELSE
   expected:=public.docket_invocation_head_identity_origin(OLD.id,OLD.organization_id);
   IF NEW.identity_origin IS DISTINCT FROM expected OR NEW.identity_review IS DISTINCT FROM public.docket_invocation_head_identity_review(OLD.id,OLD.organization_id) THEN
    RAISE EXCEPTION 'Private identity requires checked source reservation' USING ERRCODE='23514',CONSTRAINT='invocation_head_identity_origin_proof';
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.identity_origin='authored' THEN
  IF NOT public.docket_private_identity_namespace_ready() THEN
   RAISE EXCEPTION 'Private identity reservation is not ready' USING ERRCODE='23514',CONSTRAINT='private_identity_namespace_not_ready';
  END IF;
 ELSIF NEW.identity_origin='retained' THEN
  SELECT * INTO source FROM public.process_definition WHERE id=NEW.id AND organization_id=NEW.organization_id;
  IF source.id IS NULL OR NEW.canonical_authoring_at IS NOT NULL OR NEW.draft_invocation_id IS NOT NULL OR NEW.published_invocation_id IS NOT NULL
    OR NEW.status<>'draft' OR ROW(NEW.owner_actor_id,NEW.created_by,NEW.name,NEW.description,NEW.created_at,NEW.updated_at,NEW.archived_at)
     IS DISTINCT FROM ROW(source.created_by,source.created_by,source.name,source.description,source.created_at,source.updated_at,source.archived_at) THEN
   RAISE EXCEPTION 'Retained identity requires its actual original header' USING ERRCODE='23514',CONSTRAINT='invocation_head_retained_identity_reservation';
  END IF;
 ELSE
  RAISE EXCEPTION 'New private identity requires a checked origin' USING ERRCODE='23514',CONSTRAINT='invocation_head_identity_origin_proof';
 END IF;
 IF NEW.identity_review IS NOT NULL THEN RAISE EXCEPTION 'New private identity cannot forge a review' USING ERRCODE='23514',CONSTRAINT='invocation_head_identity_origin_proof'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER invocation_head_identity_origin_guard
BEFORE INSERT OR UPDATE OR DELETE ON work_template_invocation_head FOR EACH ROW
EXECUTE FUNCTION docket_guard_invocation_head_identity_origin ();

--> statement-breakpoint
CREATE FUNCTION docket_reserve_process_definition_identity () RETURNS trigger LANGUAGE plpgsql
SET
  search_path = pg_catalog,
  public AS $$
BEGIN
 -- No ON CONFLICT: an authored or foreign reservation with this ID must abort
 -- the source insertion rather than take over either identity.
 INSERT INTO public.work_template_invocation_head(id,organization_id,owner_actor_id,created_by,name,description,status,created_at,updated_at,archived_at,identity_origin)
 VALUES(NEW.id,NEW.organization_id,NEW.created_by,NEW.created_by,NEW.name,NEW.description,'draft',NEW.created_at,NEW.updated_at,NEW.archived_at,'retained');
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER process_definition_identity_reservation
AFTER INSERT ON process_definition FOR EACH ROW
EXECUTE FUNCTION docket_reserve_process_definition_identity ();

--> statement-breakpoint
CREATE FUNCTION docket_guard_private_identity_namespace () RETURNS trigger LANGUAGE plpgsql
SET
  search_path = pg_catalog,
  public AS $$
DECLARE actual_count integer; actual_hash text; missing_count integer;
BEGIN
 IF TG_OP='DELETE' OR OLD.ready_at IS NOT NULL THEN
  RAISE EXCEPTION 'Private identity namespace receipt is immutable' USING ERRCODE='23514',CONSTRAINT='identity_namespace_immutable';
 END IF;
 IF NEW.singleton IS DISTINCT FROM OLD.singleton THEN
  RAISE EXCEPTION 'Private identity namespace requires a complete checked reservation' USING ERRCODE='23514',CONSTRAINT='identity_namespace_proof';
 END IF;
 -- The lock excludes in-flight source inserts while checking their atomic head
 -- reservations. Later inserts must pass the reservation trigger above.
 LOCK TABLE public.process_definition IN SHARE MODE;
 SELECT count(*)::integer INTO missing_count FROM public.process_definition d LEFT JOIN public.work_template_invocation_head h ON h.id=d.id AND h.organization_id=d.organization_id WHERE h.id IS NULL;
 IF NEW.ready_at IS NULL THEN
  IF NEW.reserved_source_count IS NOT NULL OR NEW.coverage_hash IS NOT NULL OR NEW.unreserved_source_count IS DISTINCT FROM missing_count
   OR NEW.review_code IS DISTINCT FROM (CASE WHEN missing_count>0 THEN 'identity_collision' ELSE 'reservation_pending' END) THEN
   RAISE EXCEPTION 'Private identity review differs from current coverage' USING ERRCODE='23514',CONSTRAINT='identity_namespace_proof';
  END IF;
  RETURN NEW;
 END IF;
 IF EXISTS(SELECT 1 FROM public.process_definition d LEFT JOIN public.work_template_invocation_head h ON h.id=d.id AND h.organization_id=d.organization_id WHERE h.id IS NULL)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.process_definition'::regclass AND tgname='process_definition_identity_reservation' AND tgenabled='O') THEN
  RAISE EXCEPTION 'Private identity namespace is incomplete' USING ERRCODE='23514',CONSTRAINT='identity_namespace_proof';
 END IF;
 SELECT count(*)::integer INTO actual_count FROM public.process_definition;
 -- Fixed-size coverage facts are a receipt, not an identity-list digest. Exact
 -- namespace membership is enforced by NOT EXISTS, uniqueness and reservation.
 actual_hash:=public.docket_schedule_fingerprint(jsonb_build_object('kind','identity_namespace_coverage','revision',1,'reservedSourceCount',actual_count,'missingReservations',0,'reservationTrigger',1));
 IF NEW.reserved_source_count IS DISTINCT FROM actual_count OR NEW.coverage_hash IS DISTINCT FROM actual_hash THEN
  RAISE EXCEPTION 'Private identity reservation receipt differs' USING ERRCODE='23514',CONSTRAINT='identity_namespace_proof';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER private_identity_namespace_guard
BEFORE UPDATE OR DELETE ON work_template_identity_namespace FOR EACH ROW
EXECUTE FUNCTION docket_guard_private_identity_namespace ();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_guard_canonical_invocation_head () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source process_definition;
BEGIN
 IF TG_OP='UPDATE' AND OLD.canonical_authoring_at IS NOT NULL AND NEW.canonical_authoring_at IS DISTINCT FROM OLD.canonical_authoring_at THEN
   RAISE EXCEPTION 'Canonical authoring ownership is immutable' USING ERRCODE='23514',CONSTRAINT='invocation_head_authoring_owner';
 END IF;
 IF NEW.canonical_authoring_at IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR OLD.canonical_authoring_at IS NULL THEN
   IF NEW.identity_origin='authored' THEN
     IF NOT EXISTS(SELECT 1 FROM work_template_invocation_revision WHERE head_id=NEW.id AND organization_id=NEW.organization_id AND origin='authored')
       OR EXISTS(SELECT 1 FROM work_template_invocation_revision WHERE head_id=NEW.id AND organization_id=NEW.organization_id AND origin<>'authored') THEN
       RAISE EXCEPTION 'Fresh private ownership requires authored canonical history' USING ERRCODE='23514',CONSTRAINT='invocation_head_authoring_registration';
     END IF;
   ELSIF NEW.identity_origin='retained' THEN
   SELECT * INTO source FROM process_definition WHERE id=NEW.id AND organization_id=NEW.organization_id FOR UPDATE;
   IF source.id IS NULL OR ROW(NEW.name,NEW.description,NEW.status,NEW.archived_at) IS DISTINCT FROM ROW(source.name,source.description,source.status::text,source.archived_at)
    OR NOT EXISTS(SELECT 1 FROM process_revision WHERE definition_id=NEW.id AND organization_id=NEW.organization_id)
    OR EXISTS(SELECT 1 FROM process_revision r WHERE r.definition_id=NEW.id AND r.organization_id=NEW.organization_id AND NOT EXISTS(SELECT 1 FROM work_template_invocation_revision v WHERE v.id=r.id AND v.head_id=NEW.id AND v.organization_id=NEW.organization_id)) THEN
     RAISE EXCEPTION 'Canonical ownership requires complete registered history and current metadata' USING ERRCODE='23514',CONSTRAINT='invocation_head_authoring_registration';
   END IF;
   ELSE
    RAISE EXCEPTION 'Private identity origin is unresolved' USING ERRCODE='23514',CONSTRAINT='invocation_head_identity_origin_proof';
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
CREATE OR REPLACE FUNCTION docket_guard_invocation_revision () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE private_owner text; head_owner text; next_number integer; c work_template_blueprint_conversion; document jsonb; audit jsonb; head_origin text;
BEGIN
 IF TG_OP<>'INSERT' THEN
   IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organization WHERE id=OLD.organization_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'Private invocation revision is immutable' USING ERRCODE='23514',CONSTRAINT='invocation_revision_immutable';
 END IF;
 IF NEW.origin='authored' THEN
   SELECT manifest,owner_actor_id INTO document,private_owner FROM work_template_blueprint_invocation WHERE id=NEW.invocation_id AND organization_id=NEW.organization_id;
   SELECT owner_actor_id,identity_origin INTO head_owner,head_origin FROM work_template_invocation_head WHERE id=NEW.head_id AND organization_id=NEW.organization_id FOR UPDATE;
   IF NOT FOUND OR head_origin IS NULL THEN RAISE EXCEPTION 'Authored revision requires its current private head' USING ERRCODE='23514',CONSTRAINT='invocation_authored_proof'; END IF;
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
