CREATE TABLE "work_template_invocation_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"head_id" text NOT NULL,
	"invocation_id" text NOT NULL,
	"number" integer NOT NULL,
	"state" text NOT NULL,
	"creation_mode" text NOT NULL,
	"origin" text NOT NULL,
	"original_source_fingerprint" text NOT NULL,
	"source_archive_hash" text NOT NULL,
	"projection" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "invocation_revision_shape" CHECK ("work_template_invocation_revision"."number">0 and "work_template_invocation_revision"."origin"='retained' and "work_template_invocation_revision"."creation_mode" in('all_at_once','when_ready') and (("work_template_invocation_revision"."state"='published' and "work_template_invocation_revision"."published_at" is not null) or ("work_template_invocation_revision"."state"='pending_draft' and "work_template_invocation_revision"."published_at" is null)) and "work_template_invocation_revision"."original_source_fingerprint" ~ '^[a-f0-9]{32}$' and "work_template_invocation_revision"."source_archive_hash" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "work_template_invocation_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_template_invocation_head" ADD COLUMN "canonical_authoring_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_template_invocation_revision" ADD CONSTRAINT "work_template_invocation_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_invocation_revision" ADD CONSTRAINT "invocation_revision_head_tenant_fk" FOREIGN KEY ("head_id","organization_id") REFERENCES "public"."work_template_invocation_head"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_invocation_revision" ADD CONSTRAINT "invocation_revision_document_tenant_fk" FOREIGN KEY ("invocation_id","organization_id") REFERENCES "public"."work_template_blueprint_invocation"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invocation_revision_head_number_unique" ON "work_template_invocation_revision" USING btree ("head_id","organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invocation_revision_alias_tenant_unique" ON "work_template_invocation_revision" USING btree ("id","organization_id","head_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invocation_revision_document_unique" ON "work_template_invocation_revision" USING btree ("invocation_id","head_id","organization_id");--> statement-breakpoint
CREATE POLICY "invocation_revision_private" ON "work_template_invocation_revision" AS PERMISSIVE FOR ALL TO public USING (exists(select 1 from work_template_invocation_head h where h.id="work_template_invocation_revision"."head_id" and h.organization_id="work_template_invocation_revision"."organization_id")) WITH CHECK (exists(select 1 from work_template_invocation_head h where h.id="work_template_invocation_revision"."head_id" and h.organization_id="work_template_invocation_revision"."organization_id"));--> statement-breakpoint
CREATE FUNCTION docket_invocation_revision_projection(archive jsonb, manifest jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('revision',1,'steps',coalesce(jsonb_agg(jsonb_build_object(
   'alias',s.value->>'id','key',s.value->>'key','kind',s.value->>'kind','sort',(s.value->>'sort')::integer,
   'rootKey',m.value->>'rootKey','path',m.value->'path') order by (s.value->>'sort')::integer,s.value->>'id'),'[]'::jsonb))
 FROM jsonb_array_elements(archive->'source'->'steps') s(value)
 JOIN jsonb_array_elements(manifest->'steps') m(value) ON m.value->>'sourceStepId'=s.value->>'id'
$$;
--> statement-breakpoint
CREATE FUNCTION docket_guard_invocation_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c work_template_blueprint_conversion; document jsonb; audit jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN
   IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organization WHERE id=OLD.organization_id) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'Private invocation revision is immutable' USING ERRCODE='23514',CONSTRAINT='invocation_revision_immutable';
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
CREATE TRIGGER invocation_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON work_template_invocation_revision FOR EACH ROW EXECUTE FUNCTION docket_guard_invocation_revision();
--> statement-breakpoint
CREATE FUNCTION docket_guard_canonical_invocation_head() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source process_definition;
BEGIN
 IF TG_OP='UPDATE' AND OLD.canonical_authoring_at IS NOT NULL AND NEW.canonical_authoring_at IS DISTINCT FROM OLD.canonical_authoring_at THEN
   RAISE EXCEPTION 'Canonical authoring ownership is immutable' USING ERRCODE='23514',CONSTRAINT='invocation_head_authoring_owner';
 END IF;
 IF NEW.canonical_authoring_at IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR OLD.canonical_authoring_at IS NULL THEN
   SELECT * INTO source FROM process_definition WHERE id=NEW.id AND organization_id=NEW.organization_id FOR UPDATE;
   IF source.id IS NULL OR ROW(NEW.name,NEW.description,NEW.status,NEW.archived_at) IS DISTINCT FROM ROW(source.name,source.description,source.status::text,source.archived_at)
    OR NOT EXISTS(SELECT 1 FROM process_revision WHERE definition_id=NEW.id AND organization_id=NEW.organization_id)
    OR EXISTS(SELECT 1 FROM process_revision r WHERE r.definition_id=NEW.id AND r.organization_id=NEW.organization_id AND NOT EXISTS(SELECT 1 FROM work_template_invocation_revision v WHERE v.id=r.id AND v.head_id=NEW.id AND v.organization_id=NEW.organization_id)) THEN
     RAISE EXCEPTION 'Canonical ownership requires complete registered history and current metadata' USING ERRCODE='23514',CONSTRAINT='invocation_head_authoring_registration';
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
CREATE TRIGGER canonical_invocation_head_guard BEFORE INSERT OR UPDATE ON work_template_invocation_head FOR EACH ROW EXECUTE FUNCTION docket_guard_canonical_invocation_head();
--> statement-breakpoint
CREATE FUNCTION docket_guard_legacy_definition_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE registered boolean;
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organization WHERE id=OLD.organization_id) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.name,NEW.description,NEW.status,NEW.archived_at) IS NOT DISTINCT FROM ROW(OLD.name,OLD.description,OLD.status,OLD.archived_at) THEN RETURN NEW; END IF;
 SELECT canonical_authoring_at IS NOT NULL INTO registered FROM work_template_invocation_head WHERE id=OLD.id AND organization_id=OLD.organization_id;
 IF registered OR (registered IS NULL AND row_security_active('work_template_invocation_head')) THEN
   RAISE EXCEPTION 'Registered definition metadata belongs to its canonical head' USING ERRCODE='23514',CONSTRAINT='legacy_definition_metadata_owner';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_definition_metadata_owner BEFORE UPDATE OR DELETE ON process_definition FOR EACH ROW EXECUTE FUNCTION docket_guard_legacy_definition_metadata();
--> statement-breakpoint
CREATE FUNCTION docket_guard_registered_series_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE head work_template_invocation_head;
BEGIN
 IF NEW.definition_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO head FROM work_template_invocation_head WHERE id=NEW.definition_id AND organization_id=NEW.organization_id FOR SHARE;
 IF head.canonical_authoring_at IS NOT NULL AND (head.archived_at IS NOT NULL OR head.status='archived') THEN
   RAISE EXCEPTION 'Registered definition is archived' USING ERRCODE='23514',CONSTRAINT='registered_definition_archived';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER registered_series_definition_guard BEFORE INSERT ON recurrence_series FOR EACH ROW EXECUTE FUNCTION docket_guard_registered_series_definition();
