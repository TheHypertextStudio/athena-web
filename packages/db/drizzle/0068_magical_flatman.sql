CREATE TYPE "public"."entity_association" AS ENUM('pending', 'matched', 'unmatched');--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "entity_association" "entity_association" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "docket_entity_id" text;--> statement-breakpoint
CREATE INDEX "event_pending_association_idx" ON "event" USING btree ("organization_id","entity_kind") WHERE "event"."entity_association" = 'pending' and "event"."entity_kind" is not null;--> statement-breakpoint
CREATE INDEX "event_docket_entity_occurred_idx" ON "event" USING btree ("docket_entity_id","occurred_at") WHERE "event"."docket_entity_id" is not null;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_association_id_check" CHECK (("event"."entity_association" = 'matched') = ("event"."docket_entity_id" IS NOT NULL));--> statement-breakpoint
-- Backfill the rows that were already associated. Internal (`docket`-source) events have always
-- carried a resolved id in the `entity` jsonb, so without this every one of them would sit in the
-- re-association sweep's working set forever, finding nothing to do. Both columns move together
-- because the CHECK above makes 'matched' and a non-null id the same statement.
--
-- External rows keep the 'pending' default on purpose: their id is null because association was
-- never implemented, and the sweep resolving them IS the backfill.
UPDATE "event"
SET "docket_entity_id" = "entity"->>'docketEntityId',
    "entity_association" = 'matched'
WHERE "entity" IS NOT NULL AND "entity"->>'docketEntityId' IS NOT NULL;