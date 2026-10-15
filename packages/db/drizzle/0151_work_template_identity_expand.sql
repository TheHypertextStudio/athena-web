-- Referenced tenant keys must exist before their foreign keys are declared.
CREATE TABLE "work_type_team" (
	"organization_id" text NOT NULL,
	"work_type_id" text NOT NULL,
	"team_id" text NOT NULL,
	CONSTRAINT "work_type_team_work_type_id_team_id_pk" PRIMARY KEY("work_type_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "work_type_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_type_id" text NOT NULL,
	"number" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by_actor_id" text,
	CONSTRAINT "work_type_version_number_positive" CHECK ("work_type_version"."number" > 0)
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "work_template_authoring" text DEFAULT 'contributors' NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "is_base" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "publication_state" text DEFAULT 'legacy_pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "icon" jsonb;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "draft_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "draft_definition" jsonb;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "latest_published_version_id" text;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "work_type_id" text;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "work_type_version_id" text;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "work_type_assigned_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "work_type_assignment_source" text DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "work_type_id" text;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "work_type_version_id" text;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "work_type_assigned_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "work_type_assignment_source" text DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "work_type_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "work_type_version_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "work_type_assigned_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "work_type_assignment_source" text DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "work_type_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "work_type_version_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "work_type_assigned_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "work_type_assignment_source" text DEFAULT 'created' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "team_id_org_unique" ON "team" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_type_id_org_unique" ON "template" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "work_type_team" ADD CONSTRAINT "work_type_team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_type_team" ADD CONSTRAINT "work_type_team_tenant_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_type_team" ADD CONSTRAINT "work_type_team_definition_fk" FOREIGN KEY ("work_type_id","organization_id") REFERENCES "public"."template"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_type_version" ADD CONSTRAINT "work_type_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_type_version" ADD CONSTRAINT "work_type_version_published_by_actor_id_actor_id_fk" FOREIGN KEY ("published_by_actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_type_version" ADD CONSTRAINT "work_type_version_tenant_fk" FOREIGN KEY ("work_type_id","organization_id") REFERENCES "public"."template"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_type_version_number_unique" ON "work_type_version" USING btree ("work_type_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "work_type_version_identity_unique" ON "work_type_version" USING btree ("id","work_type_id","organization_id");--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_latest_published_version_id_work_type_version_id_fk" FOREIGN KEY ("latest_published_version_id") REFERENCES "public"."work_type_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_work_type_tenant_fk" FOREIGN KEY ("work_type_id","organization_id") REFERENCES "public"."template"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_work_type_version_fk" FOREIGN KEY ("work_type_version_id","work_type_id","organization_id") REFERENCES "public"."work_type_version"("id","work_type_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_work_type_tenant_fk" FOREIGN KEY ("work_type_id","organization_id") REFERENCES "public"."template"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_work_type_version_fk" FOREIGN KEY ("work_type_version_id","work_type_id","organization_id") REFERENCES "public"."work_type_version"("id","work_type_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_work_type_tenant_fk" FOREIGN KEY ("work_type_id","organization_id") REFERENCES "public"."template"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_work_type_version_fk" FOREIGN KEY ("work_type_version_id","work_type_id","organization_id") REFERENCES "public"."work_type_version"("id","work_type_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_work_type_tenant_fk" FOREIGN KEY ("work_type_id","organization_id") REFERENCES "public"."template"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_work_type_version_fk" FOREIGN KEY ("work_type_version_id","work_type_id","organization_id") REFERENCES "public"."work_type_version"("id","work_type_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_type_base_unique" ON "template" USING btree ("organization_id","target_type") WHERE "template"."is_base";--> statement-breakpoint
CREATE INDEX "initiative_work_type_idx" ON "initiative" USING btree ("organization_id","work_type_id");--> statement-breakpoint
CREATE INDEX "program_work_type_idx" ON "program" USING btree ("organization_id","work_type_id");--> statement-breakpoint
CREATE INDEX "project_work_type_idx" ON "project" USING btree ("organization_id","work_type_id");--> statement-breakpoint
CREATE INDEX "task_work_type_idx" ON "task" USING btree ("organization_id","work_type_id");--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_work_template_authoring_valid" CHECK ("organization"."work_template_authoring" in ('contributors', 'admins'));--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "work_type_revision_nonnegative" CHECK ("template"."draft_revision" >= 0);--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "work_type_state_valid" CHECK ("template"."publication_state" in ('legacy_pending', 'draft', 'published', 'archived'));