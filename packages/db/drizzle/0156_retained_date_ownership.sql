CREATE TABLE "work_template_retained_date_ownership" (
	"organization_id" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"source_step_id" text NOT NULL,
	"field" text NOT NULL,
	"invocation_id" text NOT NULL,
	"work_kind" text NOT NULL,
	"work_id" text NOT NULL,
	"manual" boolean NOT NULL,
	"last_derived_date" date,
	"source_fingerprint" text NOT NULL,
	CONSTRAINT "work_template_retained_date_ownership_organization_id_occurrence_id_source_step_id_field_pk" PRIMARY KEY("organization_id","occurrence_id","source_step_id","field"),
	CONSTRAINT "retained_date_field_kind" CHECK (("work_template_retained_date_ownership"."work_kind"='task' and "work_template_retained_date_ownership"."field" in ('startDate','dueDate')) or ("work_template_retained_date_ownership"."work_kind" in ('project','milestone') and "work_template_retained_date_ownership"."field" in ('startDate','targetDate') and ("work_template_retained_date_ownership"."work_kind"<>'milestone' or "work_template_retained_date_ownership"."field"='targetDate'))),
	CONSTRAINT "retained_date_range" CHECK ("work_template_retained_date_ownership"."last_derived_date" is null or "work_template_retained_date_ownership"."last_derived_date" between '0001-01-01'::date and '9999-12-31'::date)
);
--> statement-breakpoint
ALTER TABLE "work_template_retained_date_ownership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_template_retained_date_ownership" ADD CONSTRAINT "work_template_retained_date_ownership_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_retained_date_ownership" ADD CONSTRAINT "work_template_retained_date_ownership_occurrence_id_process_occurrence_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."process_occurrence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_retained_date_ownership" ADD CONSTRAINT "work_template_retained_date_ownership_source_step_id_process_step_id_fk" FOREIGN KEY ("source_step_id") REFERENCES "public"."process_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_retained_date_ownership" ADD CONSTRAINT "retained_date_invocation_tenant_fk" FOREIGN KEY ("invocation_id","organization_id") REFERENCES "public"."work_template_blueprint_invocation"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retained_date_work_idx" ON "work_template_retained_date_ownership" USING btree ("organization_id","work_kind","work_id");--> statement-breakpoint
CREATE POLICY "retained_date_private" ON "work_template_retained_date_ownership" AS PERMISSIVE FOR ALL TO public USING ("work_template_retained_date_ownership"."organization_id"=nullif(current_setting('docket.organization_id',true),'') and exists(select 1 from work_template_blueprint_invocation i where i.id="work_template_retained_date_ownership"."invocation_id" and i.organization_id="work_template_retained_date_ownership"."organization_id")) WITH CHECK ("work_template_retained_date_ownership"."organization_id"=nullif(current_setting('docket.organization_id',true),'') and exists(select 1 from work_template_blueprint_invocation i where i.id="work_template_retained_date_ownership"."invocation_id" and i.organization_id="work_template_retained_date_ownership"."organization_id"));--> statement-breakpoint
CREATE VIEW docket_retained_date_sources WITH (security_invoker=true) AS
SELECT o.organization_id, o.id AS occurrence_id, mapped.step_id AS source_step_id,
       date_field.field, invocation.id AS invocation_id, mapped.work_kind, mapped.work_id,
       md5(jsonb_build_array(o.organization_id,o.id,mapped.step_id,date_field.field,invocation.id,mapped.work_kind,mapped.work_id,preset.value)::text) AS source_fingerprint
FROM process_occurrence o
JOIN recurrence_series_revision series_revision ON series_revision.id=o.series_revision_id AND series_revision.organization_id=o.organization_id
JOIN process_instance instance ON instance.occurrence_id=o.id AND instance.organization_id=o.organization_id AND instance.revision_id=series_revision.process_revision_id
JOIN work_template_blueprint_invocation invocation ON invocation.id=coalesce(o.blueprint_invocation_id,series_revision.blueprint_invocation_id) AND invocation.organization_id=o.organization_id AND invocation.manifest->>'kind'='published' AND invocation.manifest->>'legacyProcessRevisionId'=instance.revision_id
JOIN (
 SELECT m.organization_id,m.instance_id,m.step_id,'project'::text AS work_kind,m.project_id AS work_id FROM process_instance_project m JOIN project w ON w.id=m.project_id AND w.organization_id=m.organization_id
 UNION ALL SELECT m.organization_id,m.instance_id,m.step_id,'milestone'::text,m.milestone_id FROM process_instance_milestone m JOIN milestone w ON w.id=m.milestone_id AND w.organization_id=m.organization_id
 UNION ALL SELECT m.organization_id,m.instance_id,m.step_id,'task'::text,m.task_id FROM process_instance_task m JOIN task w ON w.id=m.task_id AND w.organization_id=m.organization_id
) mapped ON mapped.instance_id=instance.id AND mapped.organization_id=o.organization_id
JOIN process_step source_step ON source_step.id=mapped.step_id AND source_step.organization_id=o.organization_id AND source_step.revision_id=instance.revision_id AND source_step.kind::text=mapped.work_kind
CROSS JOIN LATERAL jsonb_array_elements(invocation.overrides) AS preset(value)
CROSS JOIN (VALUES ('startDate','start_offset_days'),('dueDate','due_offset_days'),('targetDate','target_offset_days')) AS date_field(field,offset_key)
WHERE preset.value->>'sourceStepId'=mapped.step_id AND preset.value->>'kind'=mapped.work_kind
AND EXISTS (SELECT 1 FROM jsonb_array_elements(invocation.manifest->'steps') AS manifest_step(value) WHERE manifest_step.value->>'sourceStepId'=mapped.step_id)
AND jsonb_typeof(preset.value->'fields'->date_field.offset_key)='number'
AND ((mapped.work_kind='task' AND date_field.field IN ('startDate','dueDate')) OR (mapped.work_kind='project' AND date_field.field IN ('startDate','targetDate')) OR (mapped.work_kind='milestone' AND date_field.field='targetDate'));
--> statement-breakpoint
CREATE FUNCTION docket_check_retained_date_source(p_org text,p_occurrence text,p_step text,p_field text,p_invocation text,p_kind text,p_work text,p_fingerprint text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM docket_retained_date_sources AS source_row WHERE source_row.organization_id=p_org AND source_row.occurrence_id=p_occurrence AND source_row.source_step_id=p_step AND source_row.field=p_field AND source_row.invocation_id=p_invocation AND source_row.work_kind=p_kind AND source_row.work_id=p_work AND source_row.source_fingerprint=p_fingerprint) THEN
    RAISE EXCEPTION 'Invalid retained occurrence date ownership source' USING ERRCODE='23514';
  END IF;
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_guard_retained_date_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.organization_id,NEW.occurrence_id,NEW.source_step_id,NEW.field,NEW.invocation_id,NEW.work_kind,NEW.work_id,NEW.source_fingerprint) IS DISTINCT FROM (OLD.organization_id,OLD.occurrence_id,OLD.source_step_id,OLD.field,OLD.invocation_id,OLD.work_kind,OLD.work_id,OLD.source_fingerprint) THEN
    RAISE EXCEPTION 'Retained occurrence date ownership identity is immutable' USING ERRCODE='23514';
  END IF;
  PERFORM docket_check_retained_date_source(NEW.organization_id,NEW.occurrence_id,NEW.source_step_id,NEW.field,NEW.invocation_id,NEW.work_kind,NEW.work_id,NEW.source_fingerprint);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER retained_date_ownership_guard BEFORE INSERT OR UPDATE ON work_template_retained_date_ownership FOR EACH ROW EXECUTE FUNCTION docket_guard_retained_date_ownership();
--> statement-breakpoint
CREATE FUNCTION docket_delete_retained_work_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM work_template_retained_date_ownership WHERE organization_id=OLD.organization_id AND work_kind=TG_TABLE_NAME AND work_id=OLD.id;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER retained_task_date_delete BEFORE DELETE ON task FOR EACH ROW EXECUTE FUNCTION docket_delete_retained_work_dates();
--> statement-breakpoint
CREATE TRIGGER retained_project_date_delete BEFORE DELETE ON project FOR EACH ROW EXECUTE FUNCTION docket_delete_retained_work_dates();
--> statement-breakpoint
CREATE TRIGGER retained_milestone_date_delete BEFORE DELETE ON milestone FOR EACH ROW EXECUTE FUNCTION docket_delete_retained_work_dates();
