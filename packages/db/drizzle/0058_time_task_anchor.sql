-- Anchor every Time Ledger record and segment to the Docket Task it is about, and add the
-- revocable current-task share grant.
--
-- The two `task_id` columns end NOT NULL, which is the point: a tracked stretch of time that
-- cannot say what it was about is the failure this change exists to remove. Reaching that end
-- state on a table that already holds rows takes three steps rather than one, so the statements
-- drizzle generates as `ADD COLUMN … NOT NULL` are split here into add → backfill → constrain.
--
-- The backfill recovers a task from what a legacy record already knows: first its primary Docket
-- work-item context, then an explicit task allocation. Both are checked against `task` so a
-- context pointing at deleted work cannot resurrect a dangling reference.
--
-- A record with neither — no work-item context and no task allocation — cannot be anchored to
-- anything real, and this migration will stop rather than invent a task to hide behind. That is
-- deliberate: a synthesized placeholder would put junk in everyone's task list and would still
-- not answer what the time was spent on. It is also unreachable in production, where these tables
-- have never existed: `time_record` and `time_interval` are created by 0035_foamy_psynapse
-- (2026-07-14), after the last production deploy run (2026-07-11), so the whole Time Ledger is
-- still pending and will be created empty in the same chain run that applies this file.
CREATE TABLE "time_share_token" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"include_title" boolean DEFAULT true NOT NULL,
	"include_workspace" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_interval" ADD COLUMN "task_id" text;--> statement-breakpoint
ALTER TABLE "time_record" ADD COLUMN "task_id" text;--> statement-breakpoint
UPDATE "time_record" SET "task_id" = "time_context"."docket_entity_id" FROM "time_context" WHERE "time_context"."time_record_id" = "time_record"."id" AND "time_context"."source_system" = 'docket' AND "time_context"."entity_kind" = 'work_item' AND "time_context"."docket_entity_id" IS NOT NULL AND "time_record"."task_id" IS NULL AND EXISTS (SELECT 1 FROM "task" WHERE "task"."id" = "time_context"."docket_entity_id");--> statement-breakpoint
UPDATE "time_record" SET "task_id" = "time_allocation"."target_id" FROM "time_allocation" WHERE "time_allocation"."time_record_id" = "time_record"."id" AND "time_allocation"."target_kind" = 'task' AND "time_record"."task_id" IS NULL AND EXISTS (SELECT 1 FROM "task" WHERE "task"."id" = "time_allocation"."target_id");--> statement-breakpoint
UPDATE "time_interval" SET "task_id" = "time_record"."task_id" FROM "time_record" WHERE "time_record"."id" = "time_interval"."time_record_id" AND "time_interval"."task_id" IS NULL;--> statement-breakpoint
ALTER TABLE "time_interval" ALTER COLUMN "task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "time_record" ALTER COLUMN "task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "time_share_token" ADD CONSTRAINT "time_share_token_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_share_token" ADD CONSTRAINT "time_share_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_share_token_hash_uq" ON "time_share_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "time_share_token_hub_idx" ON "time_share_token" USING btree ("hub_id");--> statement-breakpoint
ALTER TABLE "time_interval" ADD CONSTRAINT "time_interval_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record" ADD CONSTRAINT "time_record_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_interval_task_started_idx" ON "time_interval" USING btree ("task_id","started_at");--> statement-breakpoint
CREATE INDEX "time_record_task_idx" ON "time_record" USING btree ("task_id");
