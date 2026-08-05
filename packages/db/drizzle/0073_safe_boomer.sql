CREATE TYPE "public"."team_member_role" AS ENUM('manager', 'member', 'guest');--> statement-breakpoint
ALTER TABLE "actor" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "actor" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN "role" "team_member_role" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "actor" ADD CONSTRAINT "actor_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "actor_team_uq" ON "actor" USING btree ("team_id") WHERE "actor"."team_id" is not null;--> statement-breakpoint
-- Backfill the team<->actor 1:1 before the check constraint below can hold.
--
-- Org creation has inserted an actor{kind:'team'} named after the org's default team since the
-- beginning, with no column tying it back to that team (apps/api/src/routes/orgs.ts). Those rows
-- are orphans by construction: nothing referenced them, because a team actor was not assignable.
-- Link the ones whose name still matches a team so any incidental reference survives, drop the
-- rest, then give every remaining team its actor.
--
-- The shadow actor reuses its team's id, the same move 0023 made projecting calendar_list rows
-- into calendar_layer. It keeps the backfill idempotent under ON CONFLICT and avoids minting
-- ULIDs, which SQL here has no way to do. This is a mechanism, not a contract -- application code
-- resolves a team's actor through actor.team_id and never assumes the two ids match. DISTINCT ON
-- pairs at most one actor per team, so the unique index above cannot be violated even when two
-- teams share a display name.
WITH "pairs" AS (
	SELECT DISTINCT ON ("t"."id") "t"."id" AS "team_id", "a"."id" AS "actor_id"
	FROM "team" "t"
	JOIN "actor" "a"
		ON "a"."organization_id" = "t"."organization_id"
		AND "a"."kind" = 'team'
		AND "a"."team_id" IS NULL
		AND "a"."display_name" = "t"."name"
	ORDER BY "t"."id", "a"."created_at"
)
UPDATE "actor" SET "team_id" = "pairs"."team_id"
FROM "pairs" WHERE "actor"."id" = "pairs"."actor_id";--> statement-breakpoint
DELETE FROM "actor" WHERE "kind" = 'team' AND "team_id" IS NULL;--> statement-breakpoint
INSERT INTO "actor" ("id", "organization_id", "kind", "display_name", "team_id")
SELECT "t"."id", "t"."organization_id", 'team', "t"."name", "t"."id"
FROM "team" "t"
WHERE NOT EXISTS (SELECT 1 FROM "actor" "a" WHERE "a"."team_id" = "t"."id")
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "actor" ADD CONSTRAINT "actor_team_kind_check" CHECK (("actor"."kind" = 'team') = ("actor"."team_id" is not null));