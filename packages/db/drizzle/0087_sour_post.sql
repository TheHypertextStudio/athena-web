-- Workspace-defined work statuses.
--
-- Every workspace gains a status set for Tasks, Projects, Programs, and Initiatives. The three
-- container status enums become plain text keys into that set; `task.state` already was one. Each
-- table keeps its key column and gains `status_id`, bound together by a composite foreign key over
-- (status_id, key, organization_id) so the pair provably cannot drift.
--
-- NOTE ON ENUMS: this migration only ever CREATEs types. It never runs `ALTER TYPE ... ADD VALUE`,
-- which is what `ENUM_PREFLIGHT` in `src/migrate.ts` exists to work around — drizzle batches all
-- pending migrations into one transaction, and Postgres refuses to use an enum value added in the
-- same transaction. Letting a Program complete via a `work_status` row rather than by extending
-- `program_status` is what keeps this migration out of that trap. Keep it that way.
--
-- The old `program_status`, `project_status`, and `initiative_status` types and the now-unused
-- `team.workflow_states` column are dropped one release later, so a rollout can run both versions.

CREATE TYPE "public"."work_status_category" AS ENUM('backlog', 'unstarted', 'started', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."work_status_entity" AS ENUM('task', 'project', 'program', 'initiative');--> statement-breakpoint
CREATE TABLE "work_status" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"entity_type" "work_status_entity" NOT NULL,
	"team_id" text,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "work_status_category" NOT NULL,
	"position" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "work_status_team_scope" CHECK ("work_status"."team_id" is null or "work_status"."entity_type" = 'task'),
	CONSTRAINT "work_status_never_archived" CHECK ("work_status"."archived_at" is null),
	CONSTRAINT "work_status_position_nonneg" CHECK ("work_status"."position" >= 0),
	CONSTRAINT "work_status_key_not_blank" CHECK ("work_status"."key" ~ '[^[:space:]]'),
	CONSTRAINT "work_status_name_not_blank" CHECK ("work_status"."name" ~ '[^[:space:]]')
);
--> statement-breakpoint
ALTER TABLE "work_status" ADD CONSTRAINT "work_status_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_status" ADD CONSTRAINT "work_status_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_status" ADD CONSTRAINT "work_status_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_status_org_idx" ON "work_status" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_status_id_key_org_uq" ON "work_status" USING btree ("id","key","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_status_ws_key_uq" ON "work_status" USING btree ("organization_id","entity_type","key") WHERE "work_status"."team_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_status_team_key_uq" ON "work_status" USING btree ("team_id","entity_type","key") WHERE "work_status"."team_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_status_ws_default_uq" ON "work_status" USING btree ("organization_id","entity_type") WHERE "work_status"."team_id" is null and "work_status"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "work_status_team_default_uq" ON "work_status" USING btree ("team_id","entity_type") WHERE "work_status"."team_id" is not null and "work_status"."is_default";--> statement-breakpoint
CREATE INDEX "work_status_set_idx" ON "work_status" USING btree ("organization_id","entity_type","team_id","position");--> statement-breakpoint

-- A ULID-shaped id derived from a seed string. Every Docket id is 26 Crockford-base32 characters
-- and the API validates that shape on read, so a migration that minted ids some other way would
-- produce rows the application refuses to serialize. Deterministic rather than random so this
-- migration is reproducible and its tests can assert against it. Uses only core functions (md5,
-- decode, get_byte) so it runs on PGlite as well as Postgres. Dropped at the end of the migration.
CREATE FUNCTION "docket_wsm_id"(seed text) RETURNS text AS $$
  SELECT string_agg(
      substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(bytes, i) % 32) + 1, 1),
      '' ORDER BY i)
  FROM (SELECT decode(md5(seed) || md5(seed || ':2'), 'hex') AS bytes) s,
       generate_series(0, 25) AS i;
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- The default set for each kind of container work. Mirrors DEFAULT_WORK_STATUSES in
-- `@docket/types`, which is the source every other caller reads.
INSERT INTO "work_status" ("id", "organization_id", "entity_type", "team_id", "key", "name", "description", "category", "position", "is_default")
SELECT "docket_wsm_id"(o."id" || ':' || s.entity_type || ':' || s.key),
       o."id", s.entity_type::"work_status_entity", NULL, s.key, s.name, s.description,
       s.category::"work_status_category", s.position, s.is_default
FROM "organization" o
CROSS JOIN (VALUES
  ('project','planned','Planned','Scoped and scheduled, waiting to begin.','unstarted',0,true),
  ('project','active','Active','Underway.','started',0,false),
  ('project','completed','Completed','Delivered.','completed',0,false),
  ('project','canceled','Canceled','Stopped before delivery.','canceled',0,false),
  ('program','proposed','Proposed','Suggested and awaiting a decision.','backlog',0,false),
  ('program','active','Active','Running.','started',0,true),
  ('program','paused','Paused','Running, on hold for now.','started',1,false),
  ('program','completed','Completed','Reached its end.','completed',0,false),
  ('program','archived','Archived','Retired and kept for history.','canceled',0,false),
  ('initiative','proposed','Proposed','Suggested and awaiting a decision.','backlog',0,false),
  ('initiative','active','Active','Being pursued.','started',0,true),
  ('initiative','completed','Completed','Achieved.','completed',0,false),
  ('initiative','canceled','Canceled','No longer being pursued.','canceled',0,false)
) AS s(entity_type, key, name, description, category, position, is_default);--> statement-breakpoint

-- Each team's stored workflow, normalized: blank keys dropped, duplicate keys collapsed to their
-- first occurrence, an unrecognized or missing type read as `backlog`, and a non-numeric position
-- read as the element's ordinal. None of that was ever validated on the way into the jsonb column,
-- so all of it exists somewhere.
CREATE TABLE "_wsm_team_state" AS
SELECT t."id" AS team_id, t."organization_id", e.key, e.name, e.type, e.position
FROM "team" t
CROSS JOIN LATERAL (
  SELECT DISTINCT ON (a.elem->>'key')
    a.elem->>'key' AS key,
    COALESCE(NULLIF(btrim(COALESCE(a.elem->>'name', '')), ''), a.elem->>'key') AS name,
    CASE WHEN a.elem->>'type' IN ('backlog','unstarted','started','completed','canceled')
         THEN a.elem->>'type' ELSE 'backlog' END AS type,
    CASE WHEN jsonb_typeof(a.elem->'position') = 'number'
         THEN (a.elem->>'position')::int ELSE (a.ord - 1)::int END AS position
  FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(t."workflow_states") = 'array'
              THEN t."workflow_states" ELSE '[]'::jsonb END
       ) WITH ORDINALITY AS a(elem, ord)
  WHERE COALESCE(btrim(COALESCE(a.elem->>'key', '')), '') <> ''
  ORDER BY a.elem->>'key',
           CASE WHEN jsonb_typeof(a.elem->'position') = 'number'
                THEN (a.elem->>'position')::int ELSE (a.ord - 1)::int END
) e;--> statement-breakpoint

-- The shape of a team's workflow, so teams that agree can share one workspace set.
CREATE TABLE "_wsm_team_shape" AS
SELECT team_id, organization_id,
       md5(string_agg(key || '|' || name || '|' || type, ',' ORDER BY position, key)) AS shape
FROM "_wsm_team_state"
GROUP BY team_id, organization_id;--> statement-breakpoint

-- The workspace's Task set comes from the shape most of its teams already use; ties break on the
-- oldest team so the choice is deterministic. Teams on any other shape keep theirs as a fork.
CREATE TABLE "_wsm_org_shape" AS
SELECT DISTINCT ON (g.organization_id) g.organization_id, g.shape, g.team_id
FROM (
  SELECT s.organization_id, s.shape, min(s.team_id) AS team_id, count(*) AS n
  FROM "_wsm_team_shape" s
  GROUP BY s.organization_id, s.shape
) g
ORDER BY g.organization_id, g.n DESC, g.team_id;--> statement-breakpoint

-- Every Task set to create: one per workspace, plus one per team that differs from it.
CREATE TABLE "_wsm_task_status" AS
SELECT o.organization_id, NULL::text AS team_id, st.key, st.name, st.type, st.position
FROM "_wsm_org_shape" o
JOIN "_wsm_team_state" st ON st.team_id = o.team_id
UNION ALL
SELECT sh.organization_id, sh.team_id, st.key, st.name, st.type, st.position
FROM "_wsm_team_shape" sh
JOIN "_wsm_org_shape" o ON o.organization_id = sh.organization_id
JOIN "_wsm_team_state" st ON st.team_id = sh.team_id
WHERE sh.shape <> o.shape;--> statement-breakpoint

-- A workspace with no teams, or whose teams all stored an unusable workflow, still needs a Task
-- set. It gets the canonical default rather than nothing.
INSERT INTO "_wsm_task_status" (organization_id, team_id, key, name, type, position)
SELECT o."id", NULL, s.key, s.name, s.type, s.position
FROM "organization" o
CROSS JOIN (VALUES
  ('backlog','Backlog','backlog',0),
  ('todo','Todo','unstarted',1),
  ('in_progress','In Progress','started',2),
  ('done','Done','completed',3),
  ('canceled','Canceled','canceled',4)
) AS s(key, name, type, position)
WHERE NOT EXISTS (
  SELECT 1 FROM "_wsm_task_status" x
  WHERE x.organization_id = o."id" AND x.team_id IS NULL
);--> statement-breakpoint

-- A set with no way to finish, or no way to abandon, cannot express work reaching an end. Both
-- were reachable before because the jsonb column was never checked; the runtime raised a conflict
-- when someone tried to complete a task on such a team. Synthesize what is missing instead.
INSERT INTO "_wsm_task_status" (organization_id, team_id, key, name, type, position)
SELECT s.organization_id, s.team_id,
       CASE WHEN EXISTS (SELECT 1 FROM "_wsm_task_status" x
                         WHERE x.organization_id = s.organization_id
                           AND x.team_id IS NOT DISTINCT FROM s.team_id
                           AND x.key = m.key)
            THEN m.key || '_' || substr(md5(s.organization_id || COALESCE(s.team_id, '')), 1, 6)
            ELSE m.key END,
       m.name, m.type, 1000 + m.rank
FROM (SELECT DISTINCT organization_id, team_id FROM "_wsm_task_status") s
CROSS JOIN (VALUES ('done','Done','completed',0), ('canceled','Canceled','canceled',1))
  AS m(key, name, type, rank)
WHERE NOT EXISTS (
  SELECT 1 FROM "_wsm_task_status" x
  WHERE x.organization_id = s.organization_id
    AND x.team_id IS NOT DISTINCT FROM s.team_id
    AND x.type = m.type
);--> statement-breakpoint

-- Positions are stored per category, and the lowest-positioned status is where new work lands.
INSERT INTO "work_status" ("id", "organization_id", "entity_type", "team_id", "key", "name", "category", "position", "is_default")
SELECT "docket_wsm_id"(r.organization_id || ':' || COALESCE(r.team_id, '-') || ':task:' || r.key),
       r.organization_id, 'task'::"work_status_entity", r.team_id, r.key, r.name,
       r.type::"work_status_category",
       (row_number() OVER (PARTITION BY r.organization_id, r.team_id, r.type
                           ORDER BY r.position, r.key) - 1)::int,
       row_number() OVER (PARTITION BY r.organization_id, r.team_id
                          ORDER BY r.position, r.key) = 1
FROM "_wsm_task_status" r;--> statement-breakpoint

-- The container status columns become keys into the sets seeded above.
ALTER TABLE "initiative" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "initiative" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "initiative" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "program" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "program" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "program" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "status" SET DEFAULT 'planned';--> statement-breakpoint

ALTER TABLE "initiative" ADD COLUMN "status_id" text;--> statement-breakpoint
ALTER TABLE "program" ADD COLUMN "status_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "status_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "status_id" text;--> statement-breakpoint

UPDATE "initiative" e SET "status_id" = ws."id"
FROM "work_status" ws
WHERE ws."organization_id" = e."organization_id" AND ws."entity_type" = 'initiative' AND ws."key" = e."status";--> statement-breakpoint
UPDATE "program" e SET "status_id" = ws."id"
FROM "work_status" ws
WHERE ws."organization_id" = e."organization_id" AND ws."entity_type" = 'program' AND ws."key" = e."status";--> statement-breakpoint
UPDATE "project" e SET "status_id" = ws."id"
FROM "work_status" ws
WHERE ws."organization_id" = e."organization_id" AND ws."entity_type" = 'project' AND ws."key" = e."status";--> statement-breakpoint

-- A Task resolves against its team's own set when that team kept one, and the workspace set
-- otherwise.
UPDATE "task" t SET "status_id" = ws."id"
FROM "work_status" ws
WHERE ws."entity_type" = 'task' AND ws."key" = t."state"
  AND ( ws."team_id" = t."team_id"
     OR ( ws."team_id" IS NULL
          AND ws."organization_id" = t."organization_id"
          AND NOT EXISTS (SELECT 1 FROM "work_status" f
                          WHERE f."team_id" = t."team_id" AND f."entity_type" = 'task') ) );--> statement-breakpoint

-- Work whose stored key names nothing in its set. Nothing ever prevented this: a key removed from
-- a team's workflow left its tasks pointing at a status that no longer existed, and they rendered
-- with no glyph. Repair by what the row actually is — finished, abandoned, or neither — and rewrite
-- the key to match, rather than minting a status per orphaned key and polluting the workspace.
WITH candidate AS (
  SELECT t."id" AS task_id, ws."id" AS status_id, ws."key" AS status_key, ws."position" AS pos,
         CASE
           WHEN t."completed_at" IS NOT NULL AND ws."category" = 'completed' THEN 0
           WHEN t."completed_at" IS NULL AND t."canceled_at" IS NOT NULL
                AND ws."category" = 'canceled' THEN 0
           WHEN t."completed_at" IS NULL AND t."canceled_at" IS NULL AND ws."is_default" THEN 0
           ELSE 1
         END AS pref
  FROM "task" t
  JOIN "work_status" ws
    ON ws."entity_type" = 'task'
   AND ( ws."team_id" = t."team_id"
      OR ( ws."team_id" IS NULL
           AND ws."organization_id" = t."organization_id"
           AND NOT EXISTS (SELECT 1 FROM "work_status" f
                           WHERE f."team_id" = t."team_id" AND f."entity_type" = 'task') ) )
  WHERE t."status_id" IS NULL
), ranked AS (
  SELECT c.*, row_number() OVER (PARTITION BY c.task_id
                                 ORDER BY c.pref, c.pos, c.status_key) AS rn
  FROM candidate c
)
UPDATE "task" t SET "status_id" = r.status_id, "state" = r.status_key
FROM ranked r WHERE r.task_id = t."id" AND r.rn = 1;--> statement-breakpoint

WITH ranked AS (
  SELECT e."id" AS row_id, ws."id" AS status_id, ws."key" AS status_key,
         row_number() OVER (PARTITION BY e."id"
                            ORDER BY ws."is_default" DESC, ws."position", ws."key") AS rn
  FROM "initiative" e
  JOIN "work_status" ws
    ON ws."organization_id" = e."organization_id" AND ws."entity_type" = 'initiative'
  WHERE e."status_id" IS NULL
)
UPDATE "initiative" e SET "status_id" = r.status_id, "status" = r.status_key
FROM ranked r WHERE r.row_id = e."id" AND r.rn = 1;--> statement-breakpoint
WITH ranked AS (
  SELECT e."id" AS row_id, ws."id" AS status_id, ws."key" AS status_key,
         row_number() OVER (PARTITION BY e."id"
                            ORDER BY ws."is_default" DESC, ws."position", ws."key") AS rn
  FROM "program" e
  JOIN "work_status" ws
    ON ws."organization_id" = e."organization_id" AND ws."entity_type" = 'program'
  WHERE e."status_id" IS NULL
)
UPDATE "program" e SET "status_id" = r.status_id, "status" = r.status_key
FROM ranked r WHERE r.row_id = e."id" AND r.rn = 1;--> statement-breakpoint
WITH ranked AS (
  SELECT e."id" AS row_id, ws."id" AS status_id, ws."key" AS status_key,
         row_number() OVER (PARTITION BY e."id"
                            ORDER BY ws."is_default" DESC, ws."position", ws."key") AS rn
  FROM "project" e
  JOIN "work_status" ws
    ON ws."organization_id" = e."organization_id" AND ws."entity_type" = 'project'
  WHERE e."status_id" IS NULL
)
UPDATE "project" e SET "status_id" = r.status_id, "status" = r.status_key
FROM ranked r WHERE r.row_id = e."id" AND r.rn = 1;--> statement-breakpoint

ALTER TABLE "initiative" ALTER COLUMN "status_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ALTER COLUMN "status_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "status_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "status_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "initiative" ADD CONSTRAINT "initiative_status_fk" FOREIGN KEY ("status_id","status","organization_id") REFERENCES "public"."work_status"("id","key","organization_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_status_fk" FOREIGN KEY ("status_id","status","organization_id") REFERENCES "public"."work_status"("id","key","organization_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_status_fk" FOREIGN KEY ("status_id","status","organization_id") REFERENCES "public"."work_status"("id","key","organization_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_status_fk" FOREIGN KEY ("status_id","state","organization_id") REFERENCES "public"."work_status"("id","key","organization_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "initiative_status_idx" ON "initiative" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "program_status_idx" ON "program" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "project_status_idx" ON "project" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "task_status_idx" ON "task" USING btree ("status_id");--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_status_not_blank" CHECK ("initiative"."status" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "program" ADD CONSTRAINT "program_status_not_blank" CHECK ("program"."status" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_status_not_blank" CHECK ("project"."status" ~ '[^[:space:]]');--> statement-breakpoint

DROP TABLE "_wsm_task_status";--> statement-breakpoint
DROP TABLE "_wsm_org_shape";--> statement-breakpoint
DROP TABLE "_wsm_team_shape";--> statement-breakpoint
DROP TABLE "_wsm_team_state";--> statement-breakpoint
DROP FUNCTION "docket_wsm_id"(text);
