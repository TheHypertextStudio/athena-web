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
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_position_not_blank" CHECK ("saved_view"."position" ~ '[^[:space:]]');--> statement-breakpoint
INSERT INTO "project_team" ("project_id", "team_id", "organization_id", "is_primary")
SELECT p."id", p."team_id", p."organization_id", true
FROM "project" p
JOIN "team" t ON t."id" = p."team_id" AND t."organization_id" = p."organization_id"
WHERE p."team_id" IS NOT NULL
ON CONFLICT ("project_id", "team_id") DO NOTHING;--> statement-breakpoint
WITH ordered_items AS (
	SELECT "organization_id", 'task'::text AS "target", "id" AS "item_id", "created_at" FROM "task"
	UNION ALL
	SELECT "organization_id", 'project'::text, "id", "created_at" FROM "project"
	UNION ALL
	SELECT "organization_id", 'program'::text, "id", "created_at" FROM "program"
	UNION ALL
	SELECT "organization_id", 'initiative'::text, "id", "created_at" FROM "initiative"
), ranked_items AS (
	SELECT *, row_number() OVER (
		PARTITION BY "organization_id", "target" ORDER BY "created_at", "item_id"
	) AS "position"
	FROM ordered_items
)
INSERT INTO "work_item_order" (
	"organization_id", "context_type", "context_id", "target", "item_id", "rank"
)
SELECT "organization_id", 'organization', "organization_id", "target", "item_id",
	lpad("position"::text, 12, '0')
FROM ranked_items
ON CONFLICT ("organization_id", "context_type", "context_id", "target", "item_id") DO NOTHING;--> statement-breakpoint
CREATE FUNCTION docket_legacy_task_field(legacy_field text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE legacy_field
		WHEN 'state' THEN 'status'
		WHEN 'status' THEN 'status'
		WHEN 'priority' THEN 'priority'
		WHEN 'assigneeId' THEN 'assignee'
		WHEN 'delegateId' THEN 'delegate'
		WHEN 'teamId' THEN 'team'
		WHEN 'projectId' THEN 'project'
		WHEN 'programId' THEN 'program'
		WHEN 'cycleId' THEN 'cycle'
		WHEN 'milestoneId' THEN 'milestone'
		WHEN 'parentTaskId' THEN 'parent'
		WHEN 'labels' THEN 'labels'
		WHEN 'title' THEN 'title'
		WHEN 'createdBy' THEN 'creator'
		WHEN 'startDate' THEN 'startDate'
		WHEN 'dueDate' THEN 'dueDate'
		WHEN 'createdAt' THEN 'createdAt'
		WHEN 'updatedAt' THEN 'updatedAt'
		WHEN 'estimate' THEN 'estimate'
		WHEN 'estimateMinutes' THEN 'estimateMinutes'
		WHEN 'blocked' THEN 'blocked'
		WHEN 'blocking' THEN 'blocking'
		WHEN 'archived' THEN 'archived'
		ELSE NULL
	END
$$;--> statement-breakpoint
CREATE FUNCTION docket_legacy_task_operator(legacy_field text, legacy_operator text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE legacy_operator
		WHEN 'eq' THEN CASE WHEN legacy_field = 'labels' THEN 'includesAny' ELSE 'is' END
		WHEN 'neq' THEN CASE WHEN legacy_field = 'labels' THEN 'includesNone' ELSE 'isNot' END
		WHEN 'in' THEN CASE WHEN legacy_field = 'labels' THEN 'includesAny' ELSE 'isAnyOf' END
		WHEN 'nin' THEN CASE WHEN legacy_field = 'labels' THEN 'includesNone' ELSE 'isNoneOf' END
		WHEN 'gt' THEN CASE
			WHEN legacy_field IN ('startDate', 'dueDate', 'createdAt', 'updatedAt') THEN 'after'
			ELSE 'greaterThan'
		END
		WHEN 'lt' THEN CASE
			WHEN legacy_field IN ('startDate', 'dueDate', 'createdAt', 'updatedAt') THEN 'before'
			ELSE 'lessThan'
		END
		WHEN 'contains' THEN 'contains'
		ELSE NULL
	END
$$;--> statement-breakpoint
CREATE FUNCTION docket_legacy_task_operand(legacy_field text, legacy_value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE
		WHEN legacy_field IN ('assigneeId', 'delegateId', 'createdBy') THEN
			CASE WHEN jsonb_typeof(legacy_value) = 'array' THEN (
				SELECT jsonb_agg(jsonb_build_object('kind', 'actor', 'actorId', item) ORDER BY ordinal)
				FROM jsonb_array_elements(legacy_value) WITH ORDINALITY AS values(item, ordinal)
			) ELSE jsonb_build_object('kind', 'actor', 'actorId', legacy_value) END
		WHEN legacy_field IN ('startDate', 'dueDate', 'createdAt', 'updatedAt') THEN
			CASE WHEN jsonb_typeof(legacy_value) = 'array' THEN (
				SELECT jsonb_agg(jsonb_build_object('kind', 'absolute', 'value', item) ORDER BY ordinal)
				FROM jsonb_array_elements(legacy_value) WITH ORDINALITY AS values(item, ordinal)
			) ELSE jsonb_build_object('kind', 'absolute', 'value', legacy_value) END
		WHEN legacy_field = 'labels' AND jsonb_typeof(legacy_value) <> 'array'
			THEN jsonb_build_array(legacy_value)
		ELSE legacy_value
	END
$$;--> statement-breakpoint
CREATE FUNCTION docket_legacy_task_predicate(legacy_filter jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE
		WHEN docket_legacy_task_field(legacy_filter->>'field') IS NULL
			OR docket_legacy_task_operator(legacy_filter->>'field', legacy_filter->>'op') IS NULL
		THEN jsonb_build_object(
			'kind', 'predicate', 'field', 'estimateMinutes', 'operator', 'lessThan', 'operand', 0
		)
		ELSE jsonb_build_object(
			'kind', 'predicate',
			'field', docket_legacy_task_field(legacy_filter->>'field'),
			'operator', docket_legacy_task_operator(legacy_filter->>'field', legacy_filter->>'op'),
			'operand', docket_legacy_task_operand(legacy_filter->>'field', legacy_filter->'value')
		)
	END
$$;--> statement-breakpoint
WITH ranked_views AS (
	SELECT sv."id", lpad(row_number() OVER (
		PARTITION BY sv."organization_id" ORDER BY sv."created_at", sv."id"
	)::text, 12, '0') AS "position"
	FROM "saved_view" sv
), migrated_views AS (
	SELECT sv."id", ranked."position", jsonb_build_object(
		'version', 2,
		'target', 'task',
		'filter', CASE WHEN jsonb_array_length(sv."filters") = 0 THEN NULL ELSE jsonb_build_object(
			'kind', 'all',
			'children', (
				SELECT jsonb_agg(docket_legacy_task_predicate(item) ORDER BY ordinal)
				FROM jsonb_array_elements(sv."filters") WITH ORDINALITY AS filters(item, ordinal)
			)
		) END,
		'arrangement', jsonb_build_object(
			'groupBy', CASE WHEN sv."grouping" IS NULL THEN NULL
				ELSE docket_legacy_task_field(sv."grouping"->>'by') END,
			'subGroupBy', CASE WHEN sv."grouping" IS NULL THEN NULL
				ELSE docket_legacy_task_field(sv."grouping"->>'subBy') END,
			'orderBy', (
				SELECT coalesce(jsonb_agg(jsonb_build_object(
					'field', sortable."field", 'direction', sortable."item"->>'order'
				) ORDER BY sortable."ordinal"), '[]'::jsonb)
				FROM (
					SELECT item, ordinal, docket_legacy_task_field(item->>'field') AS "field"
					FROM jsonb_array_elements(sv."sort") WITH ORDINALITY AS sorts(item, ordinal)
				) sortable
				WHERE sortable."field" IS NOT NULL
			)
		),
		'presentation', jsonb_build_object(
			'layout', 'list',
			'properties', jsonb_build_array('status', 'priority', 'assignee', 'dueDate'),
			'density', 'comfortable',
			'showEmptyGroups', false
		)
	) AS "definition"
	FROM "saved_view" sv
	JOIN ranked_views ranked ON ranked."id" = sv."id"
)
UPDATE "saved_view" sv
SET "target" = 'task', "schema_version" = 2, "position" = migrated."position",
	"definition" = migrated."definition"
FROM migrated_views migrated
WHERE migrated."id" = sv."id";--> statement-breakpoint
DROP FUNCTION docket_legacy_task_predicate(jsonb);--> statement-breakpoint
DROP FUNCTION docket_legacy_task_operand(text, jsonb);--> statement-breakpoint
DROP FUNCTION docket_legacy_task_operator(text, text);--> statement-breakpoint
DROP FUNCTION docket_legacy_task_field(text);
