DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='docket_template_copy_integrity' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolinherit)
 OR EXISTS(
      SELECT 1 FROM pg_auth_members m
      JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname='docket_template_copy_integrity'
      AND NOT COALESCE(
        current_setting('server_version_num')::integer >= 160000
        AND m.roleid=r.oid
        AND m.member=(SELECT oid FROM pg_roles WHERE rolname=CURRENT_USER AND rolcreaterole AND NOT rolsuper)
        AND m.grantor=10
        AND EXISTS(SELECT 1 FROM pg_roles WHERE oid=m.grantor AND rolsuper)
        AND m.admin_option
        AND ((to_jsonb(m)->>'inherit_option')::boolean IS FALSE)
        AND ((to_jsonb(m)->>'set_option')::boolean IS FALSE),
        false
      )
    ) THEN
 RAISE EXCEPTION 'Copy integrity role prerequisites are not satisfied'; END IF;
END $$;

--> statement-breakpoint
GRANT USAGE,
CREATE ON SCHEMA public TO docket_template_copy_integrity;

--> statement-breakpoint
GRANT docket_template_copy_integrity TO CURRENT_USER GRANTED BY CURRENT_USER;

--> statement-breakpoint
-- The trusted table owner retains the existing backend path. nonowner grants cannot bypass RLS.
ALTER TABLE template ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY template_integrity ON template FOR ALL TO docket_template_copy_integrity USING (true)
WITH
  CHECK (true);

--> statement-breakpoint
-- Match the canonical explicit-allow evaluator, including assign >= contribute. Deny precedence
-- remains deliberately deferred by that evaluator. this is not an independent permission model.
CREATE FUNCTION docket_template_author (tenant text, actor_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = pg_catalog,
  public AS $$
 SELECT public.docket_copy_active_actor(tenant,actor_key) AND EXISTS(
 SELECT 1 FROM public.actor a JOIN public.organization o ON o.id=a.organization_id
 LEFT JOIN public.role r ON r.id=a.role_id AND r.organization_id=a.organization_id
 JOIN public."grant" g ON g.organization_id=a.organization_id AND
 ((g.subject_kind='actor' AND g.subject_id=a.id) OR (g.subject_kind='role' AND g.subject_id=r.id))
 WHERE a.id=actor_key AND a.organization_id=tenant AND g.effect='allow'
 AND (g.expires_at IS NULL OR g.expires_at>now()) AND g.resource_kind='organization' AND g.resource_id=tenant
 AND (g.capabilities @> '["manage"]'::jsonb OR (o.work_template_authoring='contributors' AND g.capabilities ?| ARRAY['contribute','assign'])))
$$;

--> statement-breakpoint
ALTER FUNCTION docket_template_author (text, text) OWNER TO docket_template_copy_integrity;

--> statement-breakpoint
CREATE FUNCTION docket_template_draft_access (
  tenant text,
  visibility text,
  owner_key text,
  team_key text,
  published_key text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = pg_catalog,
  public AS $$
 SELECT public.docket_copy_acceptor_scope(tenant,nullif(current_setting('docket.actor_id',true),'')) AND (
 (visibility='personal' AND owner_key=nullif(current_setting('docket.actor_id',true),'')) OR
 (visibility='team' AND EXISTS(SELECT 1 FROM public.team_member m WHERE m.organization_id=tenant AND m.team_id=team_key AND m.actor_id=nullif(current_setting('docket.actor_id',true),''))) OR
 (visibility='organization' AND ((published_key IS NULL AND owner_key=nullif(current_setting('docket.actor_id',true),'')) OR
 (published_key IS NOT NULL AND public.docket_template_author(tenant,nullif(current_setting('docket.actor_id',true),''))))))
$$;

--> statement-breakpoint
ALTER FUNCTION docket_template_draft_access (text, text, text, text, text) OWNER TO docket_template_copy_integrity;

--> statement-breakpoint
CREATE POLICY template_body_private ON template FOR
SELECT
  TO public USING (
    docket_template_draft_access (
      organization_id,
      scope::text,
      owner_actor_id,
      team_id,
      latest_published_version_id
    )
  );

--> statement-breakpoint
CREATE POLICY template_author_insert ON template FOR INSERT TO public
WITH
  CHECK (
    docket_template_draft_access (
      organization_id,
      scope::text,
      owner_actor_id,
      team_id,
      latest_published_version_id
    )
    AND docket_template_author (
      organization_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
  );

--> statement-breakpoint
CREATE POLICY template_author_update ON template
FOR UPDATE
  TO public USING (
    docket_template_draft_access (
      organization_id,
      scope::text,
      owner_actor_id,
      team_id,
      latest_published_version_id
    )
    AND docket_template_author (
      organization_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
  )
WITH
  CHECK (
    docket_template_draft_access (
      organization_id,
      scope::text,
      owner_actor_id,
      team_id,
      latest_published_version_id
    )
    AND docket_template_author (
      organization_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
  );

--> statement-breakpoint
CREATE POLICY template_author_delete ON template FOR DELETE TO public USING (
  docket_template_draft_access (
    organization_id,
    scope::text,
    owner_actor_id,
    team_id,
    latest_published_version_id
  )
  AND docket_template_author (
    organization_id,
    nullif(current_setting('docket.actor_id', true), '')
  )
);

--> statement-breakpoint
CREATE FUNCTION docket_template_publication_visible (tenant text, template_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET
  search_path = pg_catalog,
  public AS $$
 SELECT public.docket_copy_acceptor_scope(tenant,nullif(current_setting('docket.actor_id',true),'')) AND EXISTS(
 SELECT 1 FROM public.template t WHERE t.organization_id=tenant AND t.id=template_key AND t.scope='organization' AND t.latest_published_version_id IS NOT NULL AND t.publication_state IN('published','archived'))
$$;

--> statement-breakpoint
ALTER FUNCTION docket_template_publication_visible (text, text) OWNER TO docket_template_copy_integrity;

--> statement-breakpoint
-- Version/offering checks must not depend on raw draft-row visibility.
DROP POLICY work_type_version_tenant ON work_type_version;

--> statement-breakpoint
CREATE POLICY work_type_version_tenant ON work_type_version FOR
SELECT
  TO public USING (
    docket_template_publication_visible (organization_id, work_type_id)
  );

--> statement-breakpoint
CREATE POLICY work_type_version_author_insert ON work_type_version FOR INSERT TO public
WITH
  CHECK (
    docket_template_author (
      organization_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
    AND docket_copy_definition_view (
      organization_id,
      work_type_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
  );

--> statement-breakpoint
CREATE POLICY work_type_version_author_update ON work_type_version
FOR UPDATE
  TO public USING (
    docket_template_author (
      organization_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
    AND docket_copy_definition_view (
      organization_id,
      work_type_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
  )
WITH
  CHECK (
    docket_template_author (
      organization_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
    AND docket_copy_definition_view (
      organization_id,
      work_type_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
  );

--> statement-breakpoint
CREATE POLICY work_type_version_author_delete ON work_type_version FOR DELETE TO public USING (
  docket_template_author (
    organization_id,
    nullif(current_setting('docket.actor_id', true), '')
  )
  AND docket_copy_definition_view (
    organization_id,
    work_type_id,
    nullif(current_setting('docket.actor_id', true), '')
  )
);

--> statement-breakpoint
DROP POLICY work_type_team_tenant ON work_type_team;

--> statement-breakpoint
CREATE POLICY work_type_team_tenant ON work_type_team FOR
SELECT
  TO public USING (
    docket_template_publication_visible (organization_id, work_type_id)
  );

--> statement-breakpoint
CREATE POLICY work_type_team_author_insert ON work_type_team FOR INSERT TO public
WITH
  CHECK (
    docket_template_author (
      organization_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
    AND docket_copy_definition_view (
      organization_id,
      work_type_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
  );

--> statement-breakpoint
CREATE POLICY work_type_team_author_update ON work_type_team
FOR UPDATE
  TO public USING (
    docket_template_author (
      organization_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
    AND docket_copy_definition_view (
      organization_id,
      work_type_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
  )
WITH
  CHECK (
    docket_template_author (
      organization_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
    AND docket_copy_definition_view (
      organization_id,
      work_type_id,
      nullif(current_setting('docket.actor_id', true), '')
    )
  );

--> statement-breakpoint
CREATE POLICY work_type_team_author_delete ON work_type_team FOR DELETE TO public USING (
  docket_template_author (
    organization_id,
    nullif(current_setting('docket.actor_id', true), '')
  )
  AND docket_copy_definition_view (
    organization_id,
    work_type_id,
    nullif(current_setting('docket.actor_id', true), '')
  )
);

--> statement-breakpoint
GRANT
SELECT
  (definition) ON work_type_version TO docket_template_copy_integrity;

--> statement-breakpoint
-- This projection contains only the published snapshot, never mutable draft columns.
CREATE VIEW work_template_published
WITH
  (security_barrier = true) AS
SELECT
  t.id,
  t.organization_id,
  t.target_type,
  t.scope,
  t.publication_state,
  t.latest_published_version_id,
  v.definition
FROM
  template t
  JOIN work_type_version v ON v.id = t.latest_published_version_id
  AND v.organization_id = t.organization_id
  AND v.work_type_id = t.id
WHERE
  docket_template_publication_visible (t.organization_id, t.id);

--> statement-breakpoint
ALTER VIEW work_template_published OWNER TO docket_template_copy_integrity;

--> statement-breakpoint
GRANT
SELECT
  ON work_template_published TO PUBLIC;

--> statement-breakpoint
REVOKE CREATE ON SCHEMA public
FROM
  docket_template_copy_integrity;

--> statement-breakpoint
REVOKE docket_template_copy_integrity
FROM
  CURRENT_USER GRANTED BY CURRENT_USER;
