ALTER TABLE "agent_delegation" DROP CONSTRAINT "agent_delegation_reply_key_lifecycle_check";--> statement-breakpoint
CREATE TEMP TABLE "_0115_lattice_proposal_settlement" AS
SELECT
  "delegation"."id" AS "delegation_id",
  "delegation"."session_id",
  "delegation"."returned_activity_id",
  "activity"."approval_status",
  COALESCE(("activity"."body" #>> '{action,result,isError}')::boolean, false) AS "execution_failed"
FROM "agent_delegation" AS "delegation"
LEFT JOIN "session_activity" AS "activity"
  ON "activity"."id" = "delegation"."returned_activity_id"
WHERE "delegation"."status" = 'proposed'
  AND "delegation"."reply_key_ciphertext" IS NULL;--> statement-breakpoint
UPDATE "agent_session" AS "session"
SET
  "status" = CASE
    WHEN "settlement"."approval_status" = 'applied' AND NOT "settlement"."execution_failed" THEN 'completed'
    WHEN "settlement"."approval_status" = 'rejected' THEN 'canceled'
    ELSE 'failed'
  END::"session_status",
  "current_step" = CASE
    WHEN "settlement"."approval_status" = 'applied' AND NOT "settlement"."execution_failed"
      THEN 'The Lattice result was added to the assigned task'
    WHEN "settlement"."approval_status" = 'rejected'
      THEN 'The Lattice result was rejected'
    WHEN "settlement"."approval_status" = 'applied'
      THEN 'Athena could not add the Lattice result to the assigned task.'
    ELSE 'Athena could not retain the reply key for this pending Lattice result.'
  END,
  "current_step_at" = now(),
  "ended_at" = COALESCE("session"."ended_at", now())
FROM "_0115_lattice_proposal_settlement" AS "settlement"
WHERE "session"."id" = "settlement"."session_id";--> statement-breakpoint
UPDATE "session_activity" AS "activity"
SET
  "approval_status" = 'rejected',
  "body" = jsonb_set(
    "activity"."body",
    '{action,result}',
    '{"content":"The saved Lattice reply key could not be retained during upgrade","isError":true}'::jsonb,
    true
  )
FROM "_0115_lattice_proposal_settlement" AS "settlement"
WHERE "activity"."id" = "settlement"."returned_activity_id"
  AND "settlement"."approval_status" = 'proposed';--> statement-breakpoint
UPDATE "agent_delegation" AS "delegation"
SET
  "status" = CASE
    WHEN "settlement"."approval_status" = 'applied' AND NOT "settlement"."execution_failed" THEN 'completed'
    WHEN "settlement"."approval_status" = 'rejected' THEN 'canceled'
    ELSE 'failed'
  END,
  "failure_code" = CASE
    WHEN "settlement"."approval_status" = 'applied' AND "settlement"."execution_failed"
      THEN 'task_comment_failed'
    WHEN "settlement"."approval_status" = 'proposed' OR "settlement"."approval_status" IS NULL
      THEN 'result_key_invalid'
    ELSE NULL
  END,
  "returned_activity_id" = NULL,
  "next_poll_at" = now(),
  "settled_at" = COALESCE("delegation"."settled_at", now())
FROM "_0115_lattice_proposal_settlement" AS "settlement"
WHERE "delegation"."id" = "settlement"."delegation_id";--> statement-breakpoint
DROP TABLE "_0115_lattice_proposal_settlement";--> statement-breakpoint
ALTER TABLE "agent_delegation" ADD CONSTRAINT "agent_delegation_reply_key_lifecycle_check" CHECK (("agent_delegation"."status" in ('prepared','submitted','proposed') AND "agent_delegation"."reply_key_ciphertext" IS NOT NULL)
        OR ("agent_delegation"."status" = 'failed' AND "agent_delegation"."failure_code" = 'result_decryption_failed' AND "agent_delegation"."reply_key_ciphertext" IS NOT NULL)
        OR ("agent_delegation"."status" in ('completed','failed','canceled') AND "agent_delegation"."reply_key_ciphertext" IS NULL));
