CREATE FUNCTION docket_sorted_weekdays(days integer[]) RETURNS integer[] LANGUAGE sql IMMUTABLE AS $$ SELECT array_agg(DISTINCT day ORDER BY day) FROM unnest(days) day $$;
--> statement-breakpoint
CREATE TABLE "work_template_blueprint_conversion" (
	"organization_id" text NOT NULL,
	"legacy_process_revision_id" text PRIMARY KEY NOT NULL,
	"invocation_id" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"converted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_template_blueprint_conversion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "blueprint_dependency" (
	"organization_id" text NOT NULL,
	"version_id" text NOT NULL,
	"blocker_step_id" text NOT NULL,
	"blocked_step_id" text NOT NULL,
	CONSTRAINT "blueprint_dependency_version_id_blocker_step_id_blocked_step_id_pk" PRIMARY KEY("version_id","blocker_step_id","blocked_step_id"),
	CONSTRAINT "blueprint_dependency_not_self" CHECK ("blueprint_dependency"."blocker_step_id" <> "blueprint_dependency"."blocked_step_id")
);
--> statement-breakpoint
ALTER TABLE "blueprint_dependency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_template_blueprint_invocation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_actor_id" text,
	"manifest" jsonb NOT NULL,
	"overrides" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_template_blueprint_invocation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "blueprint_step" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"version_id" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"parent_step_key" text,
	"sort" integer NOT NULL,
	"step" jsonb NOT NULL,
	CONSTRAINT "blueprint_step_key_valid" CHECK ("blueprint_step"."key" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "blueprint_step_kind_valid" CHECK ("blueprint_step"."kind" in ('program','project','task','milestone')),
	CONSTRAINT "blueprint_step_sort_nonnegative" CHECK ("blueprint_step"."sort" >= 0)
);
--> statement-breakpoint
ALTER TABLE "blueprint_step" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "working_weekdays" integer[] DEFAULT '{1,2,3,4,5}' NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "origin_work_type_id" text;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "origin_work_type_version_id" text;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "blueprint_step_id" text;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "blueprint_source_version_id" text;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "blueprint_parent_kind" text;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "blueprint_parent_id" text;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "blueprint_path" text[];--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "blueprint_date_bindings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "blueprint_state" jsonb;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "blueprint_ever_started" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "milestone" ADD COLUMN "blueprint_step_id" text;--> statement-breakpoint
ALTER TABLE "milestone" ADD COLUMN "blueprint_source_version_id" text;--> statement-breakpoint
ALTER TABLE "milestone" ADD COLUMN "blueprint_parent_kind" text;--> statement-breakpoint
ALTER TABLE "milestone" ADD COLUMN "blueprint_parent_id" text;--> statement-breakpoint
ALTER TABLE "milestone" ADD COLUMN "blueprint_path" text[];--> statement-breakpoint
ALTER TABLE "milestone" ADD COLUMN "blueprint_date_bindings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "milestone" ADD COLUMN "blueprint_state" jsonb;--> statement-breakpoint
ALTER TABLE "milestone" ADD COLUMN "blueprint_ever_started" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "blueprint_step_id" text;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "blueprint_source_version_id" text;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "blueprint_parent_kind" text;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "blueprint_parent_id" text;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "blueprint_path" text[];--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "blueprint_date_bindings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "blueprint_state" jsonb;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "blueprint_ever_started" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "blueprint_step_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "blueprint_source_version_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "blueprint_parent_kind" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "blueprint_parent_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "blueprint_path" text[];--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "blueprint_date_bindings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "blueprint_state" jsonb;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "blueprint_ever_started" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blueprint_step_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blueprint_source_version_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blueprint_parent_kind" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blueprint_parent_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blueprint_path" text[];--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blueprint_date_bindings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blueprint_state" jsonb;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "blueprint_ever_started" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "process_occurrence" ADD COLUMN "blueprint_invocation_id" text;--> statement-breakpoint
ALTER TABLE "process_occurrence" ADD COLUMN "blueprint_root_refs" jsonb;--> statement-breakpoint
ALTER TABLE "recurrence_series_revision" ADD COLUMN "work_type_id" text;--> statement-breakpoint
ALTER TABLE "recurrence_series_revision" ADD COLUMN "work_type_version_id" text;--> statement-breakpoint
ALTER TABLE "recurrence_series_revision" ADD COLUMN "blueprint_invocation_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_invocation_identity_unique" ON "work_template_blueprint_invocation" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_step_identity_unique" ON "blueprint_step" USING btree ("id","version_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_step_version_key_unique" ON "blueprint_step" USING btree ("version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "work_type_version_id_org_unique" ON "work_type_version" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "work_template_blueprint_conversion" ADD CONSTRAINT "work_template_blueprint_conversion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_blueprint_conversion" ADD CONSTRAINT "blueprint_conversion_invocation_fk" FOREIGN KEY ("invocation_id","organization_id") REFERENCES "public"."work_template_blueprint_invocation"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_dependency" ADD CONSTRAINT "blueprint_dependency_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_dependency" ADD CONSTRAINT "blueprint_dependency_blocker_fk" FOREIGN KEY ("blocker_step_id","version_id","organization_id") REFERENCES "public"."blueprint_step"("id","version_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_dependency" ADD CONSTRAINT "blueprint_dependency_blocked_fk" FOREIGN KEY ("blocked_step_id","version_id","organization_id") REFERENCES "public"."blueprint_step"("id","version_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_blueprint_invocation" ADD CONSTRAINT "work_template_blueprint_invocation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_blueprint_invocation" ADD CONSTRAINT "work_template_blueprint_invocation_owner_actor_id_actor_id_fk" FOREIGN KEY ("owner_actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_step" ADD CONSTRAINT "blueprint_step_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_step" ADD CONSTRAINT "blueprint_step_version_tenant_fk" FOREIGN KEY ("version_id","organization_id") REFERENCES "public"."work_type_version"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blueprint_invocation_owner_idx" ON "work_template_blueprint_invocation" USING btree ("organization_id","owner_actor_id");--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_blueprint_origin_fk" FOREIGN KEY ("blueprint_step_id","blueprint_source_version_id","organization_id") REFERENCES "public"."blueprint_step"("id","version_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_blueprint_origin_fk" FOREIGN KEY ("blueprint_step_id","blueprint_source_version_id","organization_id") REFERENCES "public"."blueprint_step"("id","version_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_blueprint_origin_fk" FOREIGN KEY ("blueprint_step_id","blueprint_source_version_id","organization_id") REFERENCES "public"."blueprint_step"("id","version_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_blueprint_origin_fk" FOREIGN KEY ("blueprint_step_id","blueprint_source_version_id","organization_id") REFERENCES "public"."blueprint_step"("id","version_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_blueprint_origin_fk" FOREIGN KEY ("blueprint_step_id","blueprint_source_version_id","organization_id") REFERENCES "public"."blueprint_step"("id","version_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_occurrence" ADD CONSTRAINT "occurrence_blueprint_invocation_fk" FOREIGN KEY ("blueprint_invocation_id","organization_id") REFERENCES "public"."work_template_blueprint_invocation"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_series_revision" ADD CONSTRAINT "series_blueprint_selection_fk" FOREIGN KEY ("work_type_version_id","work_type_id","organization_id") REFERENCES "public"."work_type_version"("id","work_type_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_series_revision" ADD CONSTRAINT "series_blueprint_invocation_fk" FOREIGN KEY ("blueprint_invocation_id","organization_id") REFERENCES "public"."work_template_blueprint_invocation"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initiative_blueprint_parent_idx" ON "initiative" USING btree ("organization_id","blueprint_parent_kind","blueprint_parent_id");--> statement-breakpoint
CREATE INDEX "milestone_blueprint_parent_idx" ON "milestone" USING btree ("organization_id","blueprint_parent_kind","blueprint_parent_id");--> statement-breakpoint
CREATE INDEX "program_blueprint_parent_idx" ON "program" USING btree ("organization_id","blueprint_parent_kind","blueprint_parent_id");--> statement-breakpoint
CREATE INDEX "project_blueprint_parent_idx" ON "project" USING btree ("organization_id","blueprint_parent_kind","blueprint_parent_id");--> statement-breakpoint
CREATE INDEX "task_blueprint_parent_idx" ON "task" USING btree ("organization_id","blueprint_parent_kind","blueprint_parent_id");--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_working_weekdays_valid" CHECK (cardinality("organization"."working_weekdays") between 1 and 7 and "organization"."working_weekdays" <@ ARRAY[1,2,3,4,5,6,7] and "organization"."working_weekdays" = docket_sorted_weekdays("organization"."working_weekdays"));--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_copy_origin_pair" CHECK (("template"."origin_work_type_id" is null)=("template"."origin_work_type_version_id" is null));--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_blueprint_origin_pair" CHECK (("initiative"."blueprint_step_id" is null)=("initiative"."blueprint_source_version_id" is null));--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_blueprint_parent_pair" CHECK (("initiative"."blueprint_parent_id" is null)=("initiative"."blueprint_parent_kind" is null));--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_blueprint_origin_pair" CHECK (("milestone"."blueprint_step_id" is null)=("milestone"."blueprint_source_version_id" is null));--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_blueprint_parent_pair" CHECK (("milestone"."blueprint_parent_id" is null)=("milestone"."blueprint_parent_kind" is null));--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_blueprint_origin_pair" CHECK (("program"."blueprint_step_id" is null)=("program"."blueprint_source_version_id" is null));--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_blueprint_parent_pair" CHECK (("program"."blueprint_parent_id" is null)=("program"."blueprint_parent_kind" is null));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_blueprint_origin_pair" CHECK (("project"."blueprint_step_id" is null)=("project"."blueprint_source_version_id" is null));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_blueprint_parent_pair" CHECK (("project"."blueprint_parent_id" is null)=("project"."blueprint_parent_kind" is null));--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_blueprint_origin_pair" CHECK (("task"."blueprint_step_id" is null)=("task"."blueprint_source_version_id" is null));--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_blueprint_parent_pair" CHECK (("task"."blueprint_parent_id" is null)=("task"."blueprint_parent_kind" is null));--> statement-breakpoint
ALTER TABLE "recurrence_series_revision" ADD CONSTRAINT "series_blueprint_selection_pair" CHECK (("recurrence_series_revision"."work_type_id" is null)=("recurrence_series_revision"."work_type_version_id" is null));--> statement-breakpoint
CREATE POLICY "blueprint_conversion_private" ON "work_template_blueprint_conversion" AS PERMISSIVE FOR ALL TO public USING ("work_template_blueprint_conversion"."organization_id"=nullif(current_setting('docket.organization_id',true),'') and exists(select 1 from work_template_blueprint_invocation i where i.id="work_template_blueprint_conversion"."invocation_id" and i.organization_id="work_template_blueprint_conversion"."organization_id")) WITH CHECK ("work_template_blueprint_conversion"."organization_id"=nullif(current_setting('docket.organization_id',true),'') and exists(select 1 from work_template_blueprint_invocation i where i.id="work_template_blueprint_conversion"."invocation_id" and i.organization_id="work_template_blueprint_conversion"."organization_id"));--> statement-breakpoint
CREATE POLICY "blueprint_dependency_tenant" ON "blueprint_dependency" AS PERMISSIVE FOR ALL TO public USING ("blueprint_dependency"."organization_id" = nullif(current_setting('docket.organization_id', true),'') and exists(select 1 from work_type_version v where v.id="blueprint_dependency"."version_id" and v.organization_id="blueprint_dependency"."organization_id")) WITH CHECK ("blueprint_dependency"."organization_id" = nullif(current_setting('docket.organization_id', true),''));--> statement-breakpoint
CREATE POLICY "blueprint_invocation_private" ON "work_template_blueprint_invocation" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('docket.organization_id', true),'') and exists(select 1 from actor a left join role r on r.id=a.role_id and r.organization_id=a.organization_id where a.id=nullif(current_setting('docket.actor_id', true),'') and a.organization_id=work_template_blueprint_invocation.organization_id and a.status='active' and a.archived_at is null and (a.id=work_template_blueprint_invocation.owner_actor_id or r.base_capability='manage' or r.capabilities @> '["manage"]'::jsonb))) WITH CHECK (organization_id = nullif(current_setting('docket.organization_id', true),'') and exists(select 1 from actor a left join role r on r.id=a.role_id and r.organization_id=a.organization_id where a.id=nullif(current_setting('docket.actor_id', true),'') and a.organization_id=work_template_blueprint_invocation.organization_id and a.status='active' and a.archived_at is null and (a.id=work_template_blueprint_invocation.owner_actor_id or r.base_capability='manage' or r.capabilities @> '["manage"]'::jsonb)));--> statement-breakpoint
CREATE POLICY "blueprint_step_tenant" ON "blueprint_step" AS PERMISSIVE FOR ALL TO public USING ("blueprint_step"."organization_id" = nullif(current_setting('docket.organization_id', true),'') and exists(select 1 from work_type_version v where v.id="blueprint_step"."version_id" and v.organization_id="blueprint_step"."organization_id")) WITH CHECK ("blueprint_step"."organization_id" = nullif(current_setting('docket.organization_id', true),''));
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_retained_source(revision_key text) RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT jsonb_build_object(
'definition',(select to_jsonb(d) from (select id,organization_id,name,description,status,created_by,archived_at from process_definition where id=(select definition_id from process_revision where id=revision_key)) d),
'revision',(select to_jsonb(r) from (select id,organization_id,definition_id,number,creation_mode,published_at from process_revision where id=revision_key) r),
'steps',coalesce((select jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text) from (select id,organization_id,revision_id,key,kind,sort,timing_kind,offset_days,after_step_id from process_step where revision_id=revision_key) v),'[]'::jsonb),
'projects',coalesce((select jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text) from (select step_id,organization_id,name,summary,description,lead_id,team_id,program_id,status,health,start_offset_days,target_offset_days from process_project_spec where step_id in (select id from process_step where revision_id=revision_key)) v),'[]'::jsonb),
'milestones',coalesce((select jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text) from (select step_id,organization_id,project_step_id,name,description,target_offset_days from process_milestone_spec where step_id in (select id from process_step where revision_id=revision_key)) v),'[]'::jsonb),
'tasks',coalesce((select jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text) from (select step_id,organization_id,title,description,team_id,state,priority,assignee_id,project_id,project_step_id,milestone_id,milestone_step_id,cycle_id,parent_task_id,parent_task_step_id,estimate,estimate_minutes,start_offset_days,due_offset_days,work_type_id,work_type_version_id from process_task_spec where step_id in (select id from process_step where revision_id=revision_key)) v),'[]'::jsonb),
'taskLabels',coalesce((select jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text) from (select task_step_id,label_id,organization_id from process_task_label_spec where task_step_id in (select id from process_step where revision_id=revision_key)) v),'[]'::jsonb),
'projectLabels',coalesce((select jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text) from (select project_step_id,label_id,organization_id from process_project_label_spec where project_step_id in (select id from process_step where revision_id=revision_key)) v),'[]'::jsonb),
'dependencies',coalesce((select jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text) from (select organization_id,revision_id,blocking_step_id,blocked_step_id from process_dependency where revision_id=revision_key) v),'[]'::jsonb));
$$;
--> statement-breakpoint
CREATE FUNCTION docket_blueprint_source_fingerprint(revision_key text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT md5(docket_blueprint_retained_source(revision_key)::text) $$;
