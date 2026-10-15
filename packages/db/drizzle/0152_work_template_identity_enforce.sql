-- Backfill runs before this checkpoint. Refuse enforcement on incomplete retained data.
LOCK TABLE organization, template, initiative, program, project, task IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM template WHERE publication_state = 'legacy_pending')
     OR EXISTS (SELECT 1 FROM template definition LEFT JOIN work_type_version publication
       ON publication.id = definition.latest_published_version_id
       WHERE definition.latest_published_version_id IS NOT NULL AND (
         publication.work_type_id IS DISTINCT FROM definition.id
         OR publication.organization_id IS DISTINCT FROM definition.organization_id
         OR definition.scope <> 'organization'
         OR definition.name IS DISTINCT FROM publication.definition->>'name'
         OR definition.description IS DISTINCT FROM publication.definition->>'description'
         OR definition.payload IS DISTINCT FROM publication.definition->'payload'
         OR definition.icon IS DISTINCT FROM nullif(publication.definition->'icon', 'null'::jsonb)))
     OR EXISTS (SELECT 1 FROM initiative WHERE work_type_id IS NULL OR work_type_version_id IS NULL)
     OR EXISTS (SELECT 1 FROM program WHERE work_type_id IS NULL OR work_type_version_id IS NULL)
     OR EXISTS (SELECT 1 FROM project WHERE work_type_id IS NULL OR work_type_version_id IS NULL)
     OR EXISTS (SELECT 1 FROM task WHERE work_type_id IS NULL OR work_type_version_id IS NULL)
     OR EXISTS (SELECT 1 FROM organization workspace WHERE
       (SELECT count(*) FROM template definition WHERE definition.organization_id = workspace.id
        AND definition.is_base AND definition.latest_published_version_id IS NOT NULL) <> 4) THEN
    RAISE EXCEPTION 'Work-template backfill must finish before enforcement' USING ERRCODE = '23514', CONSTRAINT = 'work_template_backfill_required';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION docket_guard_work_template_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE publication jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_base AND EXISTS (SELECT 1 FROM organization WHERE id = OLD.organization_id) THEN
      RAISE EXCEPTION 'Base templates are required' USING ERRCODE = '23514', CONSTRAINT = 'work_template_base_required';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.target_type IS DISTINCT FROM OLD.target_type OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'A template keeps its kind and workspace' USING ERRCODE = '23514', CONSTRAINT = 'work_template_definition_identity';
    END IF;
    IF OLD.is_base AND (NOT NEW.is_base OR NEW.name IS DISTINCT FROM OLD.name) THEN
      RAISE EXCEPTION 'Base template identity is fixed' USING ERRCODE = '23514', CONSTRAINT = 'work_template_base_required';
    END IF;
    IF NEW.latest_published_version_id IS NULL AND NEW.draft_definition IS NOT DISTINCT FROM OLD.draft_definition
       AND (NEW.name IS DISTINCT FROM OLD.name OR NEW.payload IS DISTINCT FROM OLD.payload
         OR NEW.description IS DISTINCT FROM OLD.description OR NEW.icon IS DISTINCT FROM OLD.icon) THEN
      NEW.draft_definition := NULL;
    END IF;
  END IF;
  IF NEW.is_base AND (NEW.publication_state = 'archived' OR NEW.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Base templates cannot be archived' USING ERRCODE = '23514', CONSTRAINT = 'work_template_base_required';
  END IF;
  IF NEW.draft_definition IS NULL THEN
    NEW.draft_definition := jsonb_build_object('name', NEW.name, 'description', NEW.description,
      'icon', NEW.icon, 'defaultStatusKey', NULL, 'payload', NEW.payload);
  END IF;
  IF NEW.payload->>'targetType' IS DISTINCT FROM NEW.target_type::text
     OR NEW.draft_definition->'payload'->>'targetType' IS DISTINCT FROM NEW.target_type::text THEN
    RAISE EXCEPTION 'Starting draft kind must match its template' USING ERRCODE = '23514', CONSTRAINT = 'work_template_definition_identity';
  END IF;
  IF NEW.latest_published_version_id IS NOT NULL THEN
    SELECT definition INTO publication FROM work_type_version
      WHERE id = NEW.latest_published_version_id AND work_type_id = NEW.id AND organization_id = NEW.organization_id;
    IF NOT FOUND OR NEW.scope <> 'organization' OR NEW.publication_state NOT IN ('published', 'archived')
       OR NEW.name IS DISTINCT FROM publication->>'name'
       OR NEW.description IS DISTINCT FROM publication->>'description'
       OR NEW.payload IS DISTINCT FROM publication->'payload'
       OR NEW.icon IS DISTINCT FROM nullif(publication->'icon', 'null'::jsonb) THEN
      RAISE EXCEPTION 'Published projection must match its version' USING ERRCODE = '23514', CONSTRAINT = 'work_template_publication_identity';
    END IF;
  ELSIF NEW.publication_state = 'published' THEN
    RAISE EXCEPTION 'A published template needs a version' USING ERRCODE = '23514', CONSTRAINT = 'work_template_publication_identity';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_template_definition_guard BEFORE INSERT OR UPDATE OR DELETE ON template
  FOR EACH ROW EXECUTE FUNCTION docket_guard_work_template_definition();
--> statement-breakpoint
CREATE FUNCTION docket_guard_work_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM organization WHERE id = OLD.organization_id) THEN
      RAISE EXCEPTION 'Published versions cannot be deleted directly' USING ERRCODE = '23514', CONSTRAINT = 'work_template_version_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Actor anonymization may clear the nullable credit without changing published content.
    IF NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
       AND NEW.work_type_id IS NOT DISTINCT FROM OLD.work_type_id AND NEW.number IS NOT DISTINCT FROM OLD.number
       AND NEW.definition IS NOT DISTINCT FROM OLD.definition AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
       AND NEW.published_by_actor_id IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Published versions are immutable' USING ERRCODE = '23514', CONSTRAINT = 'work_template_version_immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM template WHERE id = NEW.work_type_id AND organization_id = NEW.organization_id
      AND scope = 'organization' AND target_type::text = NEW.definition->'payload'->>'targetType')
     OR (NEW.published_by_actor_id IS NOT NULL AND NOT EXISTS
       (SELECT 1 FROM actor WHERE id = NEW.published_by_actor_id AND organization_id = NEW.organization_id)) THEN
    RAISE EXCEPTION 'Publication must belong to its workspace definition' USING ERRCODE = '23514', CONSTRAINT = 'work_template_version_identity';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_template_version_guard BEFORE INSERT OR UPDATE OR DELETE ON work_type_version
  FOR EACH ROW EXECUTE FUNCTION docket_guard_work_template_version();
--> statement-breakpoint
CREATE FUNCTION docket_assign_work_template_identity() RETURNS trigger LANGUAGE plpgsql AS $$
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
        AND definition.target_type::text = TG_TABLE_NAME AND definition.publication_state = 'published'
        AND definition.archived_at IS NULL AND publication.id = NEW.work_type_version_id) THEN
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
CREATE TRIGGER initiative_work_template_identity BEFORE INSERT OR UPDATE ON initiative FOR EACH ROW EXECUTE FUNCTION docket_assign_work_template_identity();
--> statement-breakpoint
CREATE TRIGGER program_work_template_identity BEFORE INSERT OR UPDATE ON program FOR EACH ROW EXECUTE FUNCTION docket_assign_work_template_identity();
--> statement-breakpoint
CREATE TRIGGER project_work_template_identity BEFORE INSERT OR UPDATE ON project FOR EACH ROW EXECUTE FUNCTION docket_assign_work_template_identity();
--> statement-breakpoint
CREATE TRIGGER task_work_template_identity BEFORE INSERT OR UPDATE ON task FOR EACH ROW EXECUTE FUNCTION docket_assign_work_template_identity();
--> statement-breakpoint
CREATE FUNCTION docket_guard_base_template_teams() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM template WHERE id = NEW.work_type_id AND organization_id = NEW.organization_id AND is_base) THEN
    RAISE EXCEPTION 'Base templates are available to every team' USING ERRCODE = '23514', CONSTRAINT = 'work_template_base_required';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_template_team_guard BEFORE INSERT OR UPDATE ON work_type_team FOR EACH ROW EXECUTE FUNCTION docket_guard_base_template_teams();
--> statement-breakpoint
ALTER TABLE "work_type_team" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_type_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template" DROP CONSTRAINT "work_type_state_valid";--> statement-breakpoint
ALTER TABLE "template" ALTER COLUMN "publication_state" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "template" ALTER COLUMN "draft_definition" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "template" ALTER COLUMN "draft_definition" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ALTER COLUMN "work_type_id" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ALTER COLUMN "work_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ALTER COLUMN "work_type_version_id" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ALTER COLUMN "work_type_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ALTER COLUMN "work_type_id" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "program" ALTER COLUMN "work_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ALTER COLUMN "work_type_version_id" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "program" ALTER COLUMN "work_type_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "work_type_id" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "work_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "work_type_version_id" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "work_type_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "work_type_id" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "work_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "work_type_version_id" SET DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "work_type_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "work_type_state_valid" CHECK ("template"."publication_state" in ('draft', 'published', 'archived'));--> statement-breakpoint
CREATE POLICY "work_type_team_tenant" ON "work_type_team" AS PERMISSIVE FOR ALL TO public USING ("work_type_team"."organization_id" = nullif(current_setting('docket.organization_id', true), '') and exists (select 1 from template definition where definition.id = "work_type_team"."work_type_id" and definition.scope = 'organization' and definition.publication_state in ('published', 'archived'))) WITH CHECK ("work_type_team"."organization_id" = nullif(current_setting('docket.organization_id', true), ''));--> statement-breakpoint
CREATE POLICY "work_type_version_tenant" ON "work_type_version" AS PERMISSIVE FOR ALL TO public USING ("work_type_version"."organization_id" = nullif(current_setting('docket.organization_id', true), '') and exists (select 1 from template definition where definition.id = "work_type_version"."work_type_id" and definition.scope = 'organization' and definition.publication_state in ('published', 'archived'))) WITH CHECK ("work_type_version"."organization_id" = nullif(current_setting('docket.organization_id', true), ''));
