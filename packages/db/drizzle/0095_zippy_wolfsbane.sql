CREATE TABLE "organization_work_view_default" (
	"organization_id" text NOT NULL,
	"target" text NOT NULL,
	"definition" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_work_view_default_organization_id_target_pk" PRIMARY KEY("organization_id","target"),
	CONSTRAINT "organization_work_view_default_target_check" CHECK ("organization_work_view_default"."target" in ('task', 'project', 'program', 'initiative'))
);
--> statement-breakpoint
CREATE TABLE "work_item_order" (
	"organization_id" text NOT NULL,
	"context_type" text NOT NULL,
	"context_id" text NOT NULL,
	"target" text NOT NULL,
	"item_id" text NOT NULL,
	"rank" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_order_organization_id_context_type_context_id_target_item_id_pk" PRIMARY KEY("organization_id","context_type","context_id","target","item_id"),
	CONSTRAINT "work_item_order_context_type_check" CHECK ("work_item_order"."context_type" in ('organization', 'team', 'project', 'program', 'initiative')),
	CONSTRAINT "work_item_order_target_check" CHECK ("work_item_order"."target" in ('task', 'project', 'program', 'initiative')),
	CONSTRAINT "work_item_order_context_id_not_blank" CHECK ("work_item_order"."context_id" ~ '[^[:space:]]'),
	CONSTRAINT "work_item_order_item_id_not_blank" CHECK ("work_item_order"."item_id" ~ '[^[:space:]]'),
	CONSTRAINT "work_item_order_rank_not_blank" CHECK ("work_item_order"."rank" ~ '[^[:space:]]')
);
--> statement-breakpoint
CREATE TABLE "project_member" (
	"project_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "project_member_project_id_actor_id_pk" PRIMARY KEY("project_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "project_team" (
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "project_team_project_id_team_id_pk" PRIMARY KEY("project_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "target" text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "context" jsonb DEFAULT '{"kind":"organization"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "position" text DEFAULT 'a0' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "schema_version" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "definition" jsonb DEFAULT '{"version":2,"target":"task","filter":null,"arrangement":{"groupBy":null,"subGroupBy":null,"orderBy":[]},"presentation":{"layout":"list","properties":["status","priority","assignee","dueDate"],"density":"comfortable","showEmptyGroups":false}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "lead_team_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "priority" "task_priority" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_work_view_default" ADD CONSTRAINT "organization_work_view_default_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_work_view_default" ADD CONSTRAINT "organization_work_view_default_updated_by_actor_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_order" ADD CONSTRAINT "work_item_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team" ADD CONSTRAINT "project_team_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team" ADD CONSTRAINT "project_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team" ADD CONSTRAINT "project_team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_order_context_rank_idx" ON "work_item_order" USING btree ("organization_id","context_type","context_id","target","rank");--> statement-breakpoint
CREATE INDEX "project_member_actor_idx" ON "project_member" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_team_one_primary_uq" ON "project_team" USING btree ("project_id") WHERE "project_team"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "project_team_team_idx" ON "project_team" USING btree ("team_id");--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_lead_team_id_team_id_fk" FOREIGN KEY ("lead_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_view_org_target_position_idx" ON "saved_view" USING btree ("organization_id","target","position");--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_target_check" CHECK ("saved_view"."target" in ('task', 'project', 'program', 'initiative'));--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_schema_version_check" CHECK ("saved_view"."schema_version" = 2);--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_position_not_blank" CHECK ("saved_view"."position" ~ '[^[:space:]]');