ALTER TABLE "process_task_spec" ADD COLUMN "work_type_id" text;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD COLUMN "work_type_version_id" text;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_work_type_tenant_fk" FOREIGN KEY ("work_type_id","organization_id") REFERENCES "public"."template"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_work_type_version_fk" FOREIGN KEY ("work_type_version_id","work_type_id","organization_id") REFERENCES "public"."work_type_version"("id","work_type_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_task_spec" ADD CONSTRAINT "process_task_spec_work_type_pair" CHECK (("process_task_spec"."work_type_id" is null) = ("process_task_spec"."work_type_version_id" is null));--> statement-breakpoint
CREATE FUNCTION docket_guard_process_task_template_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.work_type_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM template WHERE id = NEW.work_type_id
      AND organization_id = NEW.organization_id AND target_type <> 'task'
  ) THEN
    RAISE EXCEPTION 'Recurring task steps require a task template'
      USING ERRCODE = '23514', CONSTRAINT = 'process_task_spec_work_type_kind';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER process_task_spec_template_kind BEFORE INSERT OR UPDATE ON process_task_spec
  FOR EACH ROW EXECUTE FUNCTION docket_guard_process_task_template_kind();
