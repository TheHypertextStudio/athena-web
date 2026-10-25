CREATE TABLE session_template_proposal (
  activity_id text PRIMARY KEY REFERENCES session_activity (id) ON DELETE CASCADE,
  session_id text NOT NULL,
  tool_use_id text NOT NULL,
  CONSTRAINT template_proposal_tool_use UNIQUE (session_id, tool_use_id),
  organization_id text NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  recipient_actor_id text NOT NULL,
  recipient_user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  proposer_actor_id text NOT NULL,
  definition jsonb NOT NULL,
  input jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state text NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'kept', 'dismissed', 'undone')
  ),
  template_id text,
  template_revision integer,
  change_set_id text,
  notification_id text REFERENCES notification (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_proposal_action_fk FOREIGN KEY (activity_id, session_id) REFERENCES session_activity (id, session_id) ON DELETE CASCADE,
  CONSTRAINT template_proposal_recipient_fk FOREIGN KEY (recipient_actor_id, organization_id) REFERENCES actor (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT template_proposal_proposer_fk FOREIGN KEY (proposer_actor_id, organization_id) REFERENCES actor (id, organization_id) ON DELETE CASCADE
);

--> statement-breakpoint
CREATE FUNCTION docket_template_proposal_access (tenant text, recipient text, proposer text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(tenant=nullif(current_setting('docket.organization_id',true),'') AND EXISTS(
 SELECT 1 FROM actor a WHERE a.organization_id=tenant AND a.id=nullif(current_setting('docket.actor_id',true),'') AND a.id IN(recipient,proposer) AND a.status='active' AND a.archived_at IS NULL),false)
$$;

--> statement-breakpoint
ALTER TABLE session_template_proposal ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY template_proposal_private ON session_template_proposal FOR ALL TO public USING (
  docket_template_proposal_access (
    organization_id,
    recipient_actor_id,
    proposer_actor_id
  )
)
WITH
  CHECK (
    docket_template_proposal_access (
      organization_id,
      recipient_actor_id,
      proposer_actor_id
    )
  );

--> statement-breakpoint
-- Exact provider messages can contain the same private proposal. Workspace membership alone is
-- never permission to inspect a registered executor's private transcript.
ALTER TABLE agent_session_transcript ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE FUNCTION docket_session_transcript_access (session_key text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM agent_session s LEFT JOIN agent g ON g.id=s.agent_id
 JOIN actor a ON a.id=nullif(current_setting('docket.actor_id',true),'')
 WHERE s.id=session_key AND a.organization_id=nullif(current_setting('docket.organization_id',true),'') AND a.status='active' AND a.archived_at IS NULL
 AND ((s.executor_kind='athena' AND a.kind='human' AND a.user_id=s.owner_user_id) OR (s.executor_kind='registered_agent' AND a.id=g.actor_id AND a.organization_id=s.organization_id))) $$;

--> statement-breakpoint
CREATE POLICY session_transcript_executor_private ON agent_session_transcript FOR ALL TO public USING (docket_session_transcript_access (session_id))
WITH
  CHECK (docket_session_transcript_access (session_id));

--> statement-breakpoint
CREATE FUNCTION docket_template_proposal_integrity () RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reviewer actor; proposed actor; execution agent_session; registration agent;
BEGIN
 SELECT * INTO reviewer FROM actor WHERE id=NEW.recipient_actor_id AND organization_id=NEW.organization_id;
 SELECT * INTO proposed FROM actor WHERE id=NEW.proposer_actor_id AND organization_id=NEW.organization_id;
 SELECT * INTO execution FROM agent_session WHERE id=NEW.session_id;
 IF reviewer.kind<>'human' OR reviewer.user_id IS DISTINCT FROM NEW.recipient_user_id
 OR reviewer.status<>'active' OR reviewer.archived_at IS NOT NULL
 OR proposed.status<>'active' OR proposed.archived_at IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM session_activity a WHERE a.id=NEW.activity_id AND a.session_id=NEW.session_id AND a.organization_id=NEW.organization_id AND a.type='action')
 THEN RAISE EXCEPTION 'Template proposal authority mismatch' USING ERRCODE='23514'; END IF;
 IF execution.executor_kind='athena' THEN
   IF execution.owner_user_id IS DISTINCT FROM reviewer.user_id OR proposed.id IS DISTINCT FROM reviewer.id THEN RAISE EXCEPTION 'Template proposal owner mismatch' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT * INTO registration FROM agent WHERE id=execution.agent_id AND organization_id=NEW.organization_id;
   IF registration.actor_id IS DISTINCT FROM proposed.id OR execution.organization_id IS DISTINCT FROM NEW.organization_id OR
    reviewer.id IS DISTINCT FROM (CASE WHEN registration.approval_routing->>'mode'='fixed' THEN registration.approval_routing->>'approverActorId' WHEN coalesce(registration.approval_routing->>'mode','assigner')='assigner' THEN execution.initiator_id ELSE NULL END)
   THEN RAISE EXCEPTION 'Template proposal reviewer mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.activity_id,NEW.session_id,NEW.organization_id,NEW.recipient_actor_id,NEW.recipient_user_id,NEW.proposer_actor_id,NEW.definition,NEW.input) IS DISTINCT FROM (OLD.activity_id,OLD.session_id,OLD.organization_id,OLD.recipient_actor_id,OLD.recipient_user_id,OLD.proposer_actor_id,OLD.definition,OLD.input) THEN RAISE EXCEPTION 'Template proposal identity is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.template_id IS NOT NULL AND NEW.state<>'undone' AND NOT EXISTS(SELECT 1 FROM template t WHERE t.id=NEW.template_id AND t.organization_id=NEW.organization_id AND (t.owner_actor_id=NEW.proposer_actor_id OR t.owner_actor_id=NEW.recipient_actor_id)) THEN RAISE EXCEPTION 'Template proposal draft mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.change_set_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM change_set c WHERE c.id=NEW.change_set_id AND c.organization_id=NEW.organization_id AND c.actor_id IN(NEW.proposer_actor_id,NEW.recipient_actor_id)) THEN RAISE EXCEPTION 'Template proposal receipt mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

--> statement-breakpoint
CREATE TRIGGER template_proposal_integrity
BEFORE INSERT OR UPDATE ON session_template_proposal FOR EACH ROW
EXECUTE FUNCTION docket_template_proposal_integrity ();

--> statement-breakpoint
-- A durable marker survives proposal/session purge. private snapshots never become ordinary receipts.
ALTER TABLE change_set
ADD COLUMN template_review_actor_id text REFERENCES actor (id) ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE change_set
ADD CONSTRAINT template_review_receipt_owner CHECK (
  template_review_actor_id IS NULL
  OR template_review_actor_id = actor_id
);

--> statement-breakpoint
CREATE FUNCTION docket_template_review_receipt_access (tenant text, reviewer text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT reviewer IS NULL OR COALESCE(tenant=nullif(current_setting('docket.organization_id',true),'') AND reviewer=nullif(current_setting('docket.actor_id',true),'') AND EXISTS(SELECT 1 FROM actor a WHERE a.id=reviewer AND a.organization_id=tenant AND a.status='active' AND a.archived_at IS NULL),false)
$$;

--> statement-breakpoint
ALTER TABLE change_set ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY template_review_receipt_private ON change_set FOR ALL TO public USING (
  docket_template_review_receipt_access (organization_id, template_review_actor_id)
)
WITH
  CHECK (
    docket_template_review_receipt_access (organization_id, template_review_actor_id)
  );

--> statement-breakpoint
ALTER TABLE change_set_entry ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY template_review_snapshot_private ON change_set_entry FOR ALL TO public USING (
  EXISTS (
    SELECT
      1
    FROM
      change_set s
    WHERE
      s.id = change_set_entry.change_set_id
  )
)
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        change_set s
      WHERE
        s.id = change_set_entry.change_set_id
    )
  );

--> statement-breakpoint
CREATE FUNCTION docket_template_review_receipt_immutable () RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.template_review_actor_id IS NOT NULL AND NEW.template_review_actor_id IS DISTINCT FROM OLD.template_review_actor_id THEN RAISE EXCEPTION 'Template review receipt privacy is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

--> statement-breakpoint
CREATE TRIGGER template_review_receipt_immutable
BEFORE UPDATE ON change_set FOR EACH ROW
EXECUTE FUNCTION docket_template_review_receipt_immutable ();
