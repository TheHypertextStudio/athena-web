-- Copy metadata wraps canonical definitions; reserved IDs are never publications until explicit INSERT.
CREATE TABLE work_template_copy_bundle (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 accepting_actor_key text NOT NULL, accepting_actor_id text REFERENCES actor(id) ON DELETE SET NULL,
 request_id text NOT NULL, request_fingerprint text NOT NULL, review_fingerprint text NOT NULL, choices_fingerprint text NOT NULL,
 mode text NOT NULL, root_entry_keys text[] NOT NULL, receipt_key text,
 receipt_id text REFERENCES change_set(id) ON DELETE SET NULL,
 state text NOT NULL DEFAULT 'installing', undo_outcomes jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), installation_transaction_id text, installed_at timestamptz, undone_at timestamptz,
 CONSTRAINT copy_bundle_actor_tenant_fk FOREIGN KEY(accepting_actor_id,organization_id) REFERENCES actor(id,organization_id),
 CONSTRAINT copy_bundle_mode CHECK(mode IN('private_drafts','published')),
 CONSTRAINT copy_bundle_state CHECK(state IN('installing','installed','undone')),
 CONSTRAINT copy_bundle_request CHECK(length(request_id) BETWEEN 1 AND 128),
 CONSTRAINT copy_bundle_fingerprints CHECK(request_fingerprint ~ '^sha256:[0-9a-f]{64}$' AND review_fingerprint ~ '^sha256:[0-9a-f]{64}$' AND choices_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX copy_bundle_tenant_identity ON work_template_copy_bundle(id,organization_id);
--> statement-breakpoint
CREATE UNIQUE INDEX copy_bundle_request_identity ON work_template_copy_bundle(organization_id,accepting_actor_key,request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX copy_bundle_receipt_identity ON work_template_copy_bundle(receipt_key);
--> statement-breakpoint
CREATE TABLE work_template_copy_entry (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 bundle_id text NOT NULL, entry_key text NOT NULL, target_type template_target_type NOT NULL, ordinal integer NOT NULL,
 destination_work_type_id text NOT NULL, live_work_type_id text, reserved_first_version_id text NOT NULL,
 source_identity jsonb NOT NULL, source_fingerprint text NOT NULL, dependency_entry_keys text[] NOT NULL,
 after_state_fingerprint text, reservation_state text NOT NULL DEFAULT 'pending', consumed_version_id text,
 CONSTRAINT copy_entry_bundle_tenant_fk FOREIGN KEY(bundle_id,organization_id) REFERENCES work_template_copy_bundle(id,organization_id) ON DELETE CASCADE,
 CONSTRAINT copy_entry_live_destination_fk FOREIGN KEY(live_work_type_id,organization_id) REFERENCES template(id,organization_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT copy_entry_consumed_version_fk FOREIGN KEY(consumed_version_id,live_work_type_id,organization_id) REFERENCES work_type_version(id,work_type_id,organization_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT copy_entry_order CHECK(ordinal BETWEEN 0 AND 99),
 CONSTRAINT copy_entry_state CHECK(reservation_state IN('pending','consumed','void')),
 CONSTRAINT copy_entry_live_identity CHECK(live_work_type_id IS NULL OR live_work_type_id=destination_work_type_id),
 CONSTRAINT copy_entry_version_identity CHECK(consumed_version_id IS NULL OR consumed_version_id=reserved_first_version_id),
 CONSTRAINT copy_entry_fingerprint CHECK(source_fingerprint ~ '^sha256:[0-9a-f]{64}$' AND (after_state_fingerprint IS NULL OR after_state_fingerprint ~ '^sha256:[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX copy_entry_key_identity ON work_template_copy_entry(bundle_id,entry_key);
--> statement-breakpoint
CREATE UNIQUE INDEX copy_entry_order_identity ON work_template_copy_entry(bundle_id,ordinal);
--> statement-breakpoint
CREATE UNIQUE INDEX copy_entry_destination_identity ON work_template_copy_entry(destination_work_type_id);
--> statement-breakpoint
CREATE UNIQUE INDEX copy_entry_reserved_identity ON work_template_copy_entry(reserved_first_version_id);
--> statement-breakpoint
CREATE INDEX copy_entry_bundle_idx ON work_template_copy_entry(organization_id,bundle_id);
--> statement-breakpoint
CREATE FUNCTION docket_copy_active_actor(tenant text,actor_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE(tenant=nullif(current_setting('docket.organization_id',true),'')
 AND actor_key=nullif(current_setting('docket.actor_id',true),'')
 AND EXISTS(SELECT 1 FROM public.actor a WHERE a.id=actor_key AND a.organization_id=tenant AND a.status='active' AND a.archived_at IS NULL),false)
$$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_acceptor_scope(tenant text,actor_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.docket_copy_active_actor(tenant,actor_key) AND EXISTS(
 SELECT 1 FROM public.actor a LEFT JOIN public.role r ON r.id=a.role_id AND r.organization_id=a.organization_id
 JOIN public."grant" g ON g.organization_id=a.organization_id AND ((g.subject_kind='actor' AND g.subject_id=a.id) OR (g.subject_kind='role' AND g.subject_id=r.id))
 WHERE a.id=actor_key AND a.organization_id=tenant AND g.effect='allow' AND (g.expires_at IS NULL OR g.expires_at>=now())
 AND g.resource_kind='organization' AND g.resource_id=tenant AND jsonb_array_length(g.capabilities)>0)
$$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_author(tenant text,actor_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.docket_copy_active_actor(tenant,actor_key) AND EXISTS(
 SELECT 1 FROM public.actor a JOIN public.organization o ON o.id=a.organization_id
 LEFT JOIN public.role r ON r.id=a.role_id AND r.organization_id=a.organization_id
 JOIN public."grant" g ON g.organization_id=a.organization_id AND
 ((g.subject_kind='actor' AND g.subject_id=a.id) OR (g.subject_kind='role' AND g.subject_id=r.id))
 WHERE a.id=actor_key AND a.organization_id=tenant AND g.effect='allow'
 AND (g.expires_at IS NULL OR g.expires_at>=now()) AND g.resource_kind='organization' AND g.resource_id=tenant
 AND (g.capabilities @> '["manage"]'::jsonb OR (o.work_template_authoring='contributors' AND g.capabilities @> '["contribute"]'::jsonb)))
$$;
--> statement-breakpoint
ALTER TABLE work_template_copy_bundle ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE work_template_copy_entry ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY copy_bundle_acceptor_private ON work_template_copy_bundle FOR ALL TO public
 USING(docket_copy_acceptor_scope(organization_id,accepting_actor_id)) WITH CHECK(docket_copy_acceptor_scope(organization_id,accepting_actor_id));
--> statement-breakpoint
CREATE POLICY copy_entry_acceptor_private ON work_template_copy_entry FOR ALL TO public
 USING(EXISTS(SELECT 1 FROM work_template_copy_bundle b WHERE b.id=bundle_id AND b.organization_id=work_template_copy_entry.organization_id AND docket_copy_acceptor_scope(b.organization_id,b.accepting_actor_id)))
 WITH CHECK(EXISTS(SELECT 1 FROM work_template_copy_bundle b WHERE b.id=bundle_id AND b.organization_id=work_template_copy_entry.organization_id AND docket_copy_acceptor_scope(b.organization_id,b.accepting_actor_id)));
--> statement-breakpoint
-- Non-login helper owner has no source/receipt-body access and is never granted to an application role.
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='docket_template_copy_integrity') THEN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='docket_template_copy_integrity' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit))
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='docket_template_copy_integrity')
    OR EXISTS(SELECT 1 FROM pg_roles r JOIN pg_class c ON c.relowner=r.oid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname='docket_template_copy_integrity' AND n.nspname='public')
    OR EXISTS(SELECT 1 FROM pg_roles r JOIN pg_proc p ON p.proowner=r.oid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE r.rolname='docket_template_copy_integrity' AND n.nspname='public')
    OR EXISTS(SELECT 1 FROM pg_roles r JOIN pg_namespace n ON n.nspowner=r.oid WHERE r.rolname='docket_template_copy_integrity' AND n.nspname='public')
    OR EXISTS(SELECT 1 FROM pg_roles r JOIN pg_class c ON true CROSS JOIN LATERAL aclexplode(c.relacl) permission WHERE r.rolname='docket_template_copy_integrity' AND permission.grantee=r.oid)
    OR EXISTS(SELECT 1 FROM pg_roles r JOIN pg_attribute a ON true CROSS JOIN LATERAL aclexplode(a.attacl) permission WHERE r.rolname='docket_template_copy_integrity' AND permission.grantee=r.oid) THEN
   RAISE EXCEPTION 'Unsafe preexisting copy integrity role'; END IF;
 ELSE CREATE ROLE docket_template_copy_integrity NOLOGIN NOINHERIT; END IF;
END $$;
--> statement-breakpoint
GRANT USAGE,CREATE ON SCHEMA public TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT docket_template_copy_integrity TO CURRENT_USER;
--> statement-breakpoint
GRANT SELECT(id,organization_id,accepting_actor_key,accepting_actor_id,mode,root_entry_keys,receipt_key,receipt_id,state,installation_transaction_id,installed_at,undone_at,undo_outcomes) ON work_template_copy_bundle TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(id,organization_id,bundle_id,entry_key,target_type,ordinal,destination_work_type_id,live_work_type_id,reserved_first_version_id,dependency_entry_keys,after_state_fingerprint,reservation_state,consumed_version_id) ON work_template_copy_entry TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT UPDATE(reservation_state,consumed_version_id) ON work_template_copy_entry TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(id,organization_id,user_id,status,archived_at,role_id) ON actor TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(id,work_template_authoring) ON organization TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(id,organization_id) ON role TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(organization_id,subject_kind,subject_id,resource_kind,resource_id,effect,expires_at,capabilities) ON "grant" TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(organization_id,actor_id,team_id) ON team_member TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(id,organization_id,scope,owner_actor_id,team_id,latest_published_version_id,is_base,publication_state) ON template TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(id,organization_id,work_type_id,number) ON work_type_version TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(id,organization_id,actor_id) ON change_set TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(change_set_id,entity_kind,entity_id,op) ON change_set_entry TO docket_template_copy_integrity;
--> statement-breakpoint
CREATE POLICY copy_bundle_integrity ON work_template_copy_bundle FOR ALL TO docket_template_copy_integrity USING(true) WITH CHECK(true);
--> statement-breakpoint
CREATE POLICY copy_entry_integrity ON work_template_copy_entry FOR ALL TO docket_template_copy_integrity USING(true) WITH CHECK(true);
--> statement-breakpoint
CREATE POLICY copy_version_integrity ON work_type_version FOR SELECT TO docket_template_copy_integrity USING(true);
--> statement-breakpoint
CREATE FUNCTION docket_copy_source_valid(value jsonb,fingerprint text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE value->>'kind'
 WHEN 'publication' THEN public.docket_schedule_keys(value,ARRAY['kind','organizationId','workTypeId','workTypeVersionId'])
   AND value->>'organizationId' ~ '^[0-9A-HJKMNP-TV-Z]{26}$' AND value->>'workTypeId' ~ '^[0-9A-HJKMNP-TV-Z]{26}$' AND value->>'workTypeVersionId' ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
 WHEN 'catalog' THEN public.docket_schedule_keys(value,ARRAY['kind','release','workTypeId','catalogVersionId'])
   AND jsonb_typeof(value->'release')='number' AND value->>'release' ~ '^[1-9][0-9]*$'
   AND value->>'workTypeId' ~ '^[0-9A-HJKMNP-TV-Z]{26}$' AND value->>'catalogVersionId' ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
 WHEN 'draft' THEN public.docket_schedule_keys(value,ARRAY['kind','organizationId','workTypeId','draftRevision','draftFingerprint'])
   AND value->>'organizationId' ~ '^[0-9A-HJKMNP-TV-Z]{26}$' AND value->>'workTypeId' ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
   AND jsonb_typeof(value->'draftRevision')='number' AND value->>'draftRevision' ~ '^(0|[1-9][0-9]*)$'
   AND value->>'draftFingerprint'=fingerprint
 ELSE false END
$$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_identity_lock(keys text[]) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE identity_key text;
BEGIN
 FOR identity_key IN SELECT DISTINCT item.value FROM unnest(keys) AS item(value) ORDER BY item.value LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('work-template-copy:'||identity_key,0));
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_entry_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE owning record; identity_key text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.organization o WHERE o.id=OLD.organization_id) THEN
   RAISE EXCEPTION 'Copy reservation tombstones cannot be deleted' USING ERRCODE='23514',CONSTRAINT='copy_entry_immutable'; END IF;
  RETURN OLD;
 END IF;
 SELECT b.state,b.accepting_actor_id INTO STRICT owning FROM public.work_template_copy_bundle b WHERE b.id=NEW.bundle_id AND b.organization_id=NEW.organization_id;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['live_work_type_id','reservation_state','consumed_version_id','after_state_fingerprint']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['live_work_type_id','reservation_state','consumed_version_id','after_state_fingerprint'])
    OR (OLD.after_state_fingerprint IS NOT NULL AND NEW.after_state_fingerprint IS DISTINCT FROM OLD.after_state_fingerprint)
    OR (OLD.after_state_fingerprint IS NULL AND NEW.after_state_fingerprint IS NOT NULL AND owning.state<>'installing')
    OR (OLD.reservation_state='void' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
    OR (OLD.reservation_state='consumed' AND (to_jsonb(NEW)-'after_state_fingerprint') IS DISTINCT FROM (to_jsonb(OLD)-'after_state_fingerprint')) THEN
   RAISE EXCEPTION 'Copy reservation provenance is immutable' USING ERRCODE='23514',CONSTRAINT='copy_entry_immutable'; END IF;
  IF NEW.reservation_state='consumed' AND (NEW.consumed_version_id IS DISTINCT FROM NEW.reserved_first_version_id OR NOT EXISTS(
     SELECT 1 FROM public.work_type_version v WHERE v.id=NEW.reserved_first_version_id AND v.organization_id=NEW.organization_id AND v.work_type_id=NEW.destination_work_type_id AND v.number=1)) THEN
   RAISE EXCEPTION 'Copy reservation requires actual first publication' USING ERRCODE='23514',CONSTRAINT='copy_entry_consumption'; END IF;
  IF NEW.reservation_state='void' AND (owning.state='installing' OR NEW.live_work_type_id IS NOT NULL OR NEW.consumed_version_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Void reservation keeps no live destination' USING ERRCODE='23514',CONSTRAINT='copy_entry_void'; END IF;
  RETURN NEW;
 END IF;
 IF owning.state<>'installing' OR NOT public.docket_copy_author(NEW.organization_id,owning.accepting_actor_id)
   OR NEW.reservation_state<>'pending' OR NEW.consumed_version_id IS NOT NULL OR NEW.after_state_fingerprint IS NOT NULL
   OR NEW.live_work_type_id IS DISTINCT FROM NEW.destination_work_type_id OR NEW.entry_key !~ '^[a-zA-Z0-9_-]{1,128}$'
   OR NEW.destination_work_type_id !~ '^[0-9A-HJKMNP-TV-Z]{26}$' OR NEW.reserved_first_version_id !~ '^[0-9A-HJKMNP-TV-Z]{26}$'
   OR NEW.destination_work_type_id=NEW.reserved_first_version_id
   OR COALESCE(NEW.destination_work_type_id IN(NEW.source_identity->>'workTypeId',NEW.source_identity->>'workTypeVersionId',NEW.source_identity->>'catalogVersionId'),false)
   OR COALESCE(NEW.reserved_first_version_id IN(NEW.source_identity->>'workTypeId',NEW.source_identity->>'workTypeVersionId',NEW.source_identity->>'catalogVersionId'),false) OR NOT COALESCE(public.docket_copy_source_valid(NEW.source_identity,NEW.source_fingerprint),false) THEN
  RAISE EXCEPTION 'Invalid copy reservation' USING ERRCODE='23514',CONSTRAINT='copy_entry_identity'; END IF;
 PERFORM public.docket_copy_identity_lock(ARRAY[NEW.destination_work_type_id,NEW.reserved_first_version_id]);
 FOREACH identity_key IN ARRAY ARRAY[NEW.destination_work_type_id,NEW.reserved_first_version_id] LOOP
  IF EXISTS(SELECT 1 FROM public.template t WHERE t.id=identity_key) OR EXISTS(SELECT 1 FROM public.work_type_version v WHERE v.id=identity_key)
    OR EXISTS(SELECT 1 FROM public.work_template_copy_entry e WHERE e.destination_work_type_id=identity_key OR e.reserved_first_version_id=identity_key) THEN
   RAISE EXCEPTION 'Copy identity is already allocated' USING ERRCODE='23514',CONSTRAINT='copy_identity_unique'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER copy_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON work_template_copy_entry FOR EACH ROW EXECUTE FUNCTION docket_copy_entry_guard();
--> statement-breakpoint
CREATE FUNCTION docket_copy_bundle_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.organization o WHERE o.id=OLD.organization_id) THEN
   RAISE EXCEPTION 'Copy bundle audit cannot be deleted' USING ERRCODE='23514',CONSTRAINT='copy_bundle_immutable'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'installing' OR NEW.accepting_actor_key IS DISTINCT FROM NEW.accepting_actor_id
    OR NOT public.docket_copy_author(NEW.organization_id,NEW.accepting_actor_id)
    OR NEW.receipt_key IS NOT NULL OR NEW.receipt_id IS NOT NULL OR NEW.installation_transaction_id IS NOT NULL OR NEW.installed_at IS NOT NULL OR NEW.undone_at IS NOT NULL OR NEW.undo_outcomes IS NOT NULL THEN
   RAISE EXCEPTION 'Copy bundle requires current accepting author' USING ERRCODE='23514',CONSTRAINT='copy_bundle_author'; END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['accepting_actor_id','receipt_key','receipt_id','state','installation_transaction_id','installed_at','undone_at','undo_outcomes']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['accepting_actor_id','receipt_key','receipt_id','state','installation_transaction_id','installed_at','undone_at','undo_outcomes'])
    OR (NEW.accepting_actor_id IS DISTINCT FROM OLD.accepting_actor_id AND
       (NEW.accepting_actor_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.actor a WHERE a.id=OLD.accepting_actor_id)))
    OR (OLD.receipt_key IS NOT NULL AND NEW.receipt_key IS DISTINCT FROM OLD.receipt_key)
    OR (OLD.installation_transaction_id IS NOT NULL AND NEW.installation_transaction_id IS DISTINCT FROM OLD.installation_transaction_id)
    OR (OLD.installed_at IS NOT NULL AND NEW.installed_at IS DISTINCT FROM OLD.installed_at)
    OR (NEW.receipt_id IS DISTINCT FROM OLD.receipt_id AND OLD.receipt_id IS NOT NULL AND
       (NEW.receipt_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.change_set c WHERE c.id=OLD.receipt_id))) THEN
  RAISE EXCEPTION 'Copy bundle review is immutable' USING ERRCODE='23514',CONSTRAINT='copy_bundle_immutable'; END IF;
 IF OLD.state='undone' AND (to_jsonb(NEW)-ARRAY['accepting_actor_id','receipt_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['accepting_actor_id','receipt_id']) THEN
  RAISE EXCEPTION 'Undone copy bundle is terminal' USING ERRCODE='23514',CONSTRAINT='copy_bundle_terminal'; END IF;
 IF NEW.state<>OLD.state AND NOT ((OLD.state='installing' AND NEW.state='installed') OR (OLD.state='installed' AND NEW.state='undone')) THEN
  RAISE EXCEPTION 'Invalid copy bundle transition' USING ERRCODE='23514',CONSTRAINT='copy_bundle_transition'; END IF;
 IF OLD.state='installing' AND NEW.state='installed' THEN NEW.installation_transaction_id:=pg_current_xact_id()::text; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER copy_bundle_guard BEFORE INSERT OR UPDATE OR DELETE ON work_template_copy_bundle FOR EACH ROW EXECUTE FUNCTION docket_copy_bundle_guard();
--> statement-breakpoint
CREATE FUNCTION docket_copy_commit_bundle(bundle_key text,tenant text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE owning record; total integer; member record;
BEGIN
 SELECT b.state,b.mode,b.root_entry_keys,b.receipt_key,b.receipt_id,b.accepting_actor_key,b.accepting_actor_id,b.installation_transaction_id,b.installed_at,b.undone_at,b.undo_outcomes INTO owning
 FROM public.work_template_copy_bundle b WHERE b.id=bundle_key AND b.organization_id=tenant;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT count(*) INTO total FROM public.work_template_copy_entry e WHERE e.bundle_id=bundle_key AND e.organization_id=tenant;
 IF owning.state='installing' OR total NOT BETWEEN 1 AND 100 OR owning.receipt_key IS NULL OR owning.installed_at IS NULL OR owning.installation_transaction_id IS NULL
   OR (SELECT COALESCE(sum(cardinality(e.dependency_entry_keys)),0) FROM public.work_template_copy_entry e WHERE e.bundle_id=bundle_key AND e.organization_id=tenant)>2000
   OR cardinality(owning.root_entry_keys) NOT BETWEEN 1 AND total
   OR cardinality(owning.root_entry_keys)<>(SELECT count(DISTINCT root.value) FROM unnest(owning.root_entry_keys) root(value))
   OR EXISTS(SELECT 1 FROM unnest(owning.root_entry_keys) root(value) WHERE NOT EXISTS(
     SELECT 1 FROM public.work_template_copy_entry e WHERE e.bundle_id=bundle_key AND e.organization_id=tenant AND e.entry_key=root.value))
   OR (owning.receipt_id IS NOT NULL AND (owning.receipt_id<>owning.receipt_key OR NOT EXISTS(
     SELECT 1 FROM public.change_set c WHERE c.id=owning.receipt_id AND c.organization_id=tenant AND c.actor_id=owning.accepting_actor_key)))
   OR (owning.receipt_id IS NULL AND owning.accepting_actor_id IS NOT NULL)
   OR (owning.state='installed' AND (owning.undone_at IS NOT NULL OR owning.undo_outcomes IS NOT NULL))
   OR (owning.state='undone' AND (owning.undone_at IS NULL OR jsonb_typeof(owning.undo_outcomes)<>'array' OR jsonb_array_length(owning.undo_outcomes)<>total)) THEN
  RAISE EXCEPTION 'Copy bundle must commit a complete installation' USING ERRCODE='23514',CONSTRAINT='copy_bundle_complete'; END IF;
 IF owning.state='undone' AND (
   (SELECT count(DISTINCT outcome.value->>'entryKey') FROM jsonb_array_elements(owning.undo_outcomes) outcome(value))<>total
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(owning.undo_outcomes) outcome(value) WHERE
     NOT COALESCE(public.docket_schedule_keys(outcome.value,ARRAY['entryKey','outcome']),false)
     OR outcome.value->>'outcome' NOT IN('deleted','archived','retained_changed','retained_in_use')
     OR NOT EXISTS(SELECT 1 FROM public.work_template_copy_entry e WHERE e.bundle_id=bundle_key AND e.organization_id=tenant AND e.entry_key=outcome.value->>'entryKey'
       AND ((outcome.value->>'outcome'='deleted' AND e.reservation_state='void') OR (outcome.value->>'outcome'<>'deleted' AND e.reservation_state<>'void'))))) THEN
  RAISE EXCEPTION 'Copy undo outcomes must match exact members' USING ERRCODE='23514',CONSTRAINT='copy_bundle_outcomes'; END IF;
 IF EXISTS(WITH RECURSIVE reachable(key) AS (SELECT unnest(owning.root_entry_keys) UNION SELECT unnest(e.dependency_entry_keys) FROM public.work_template_copy_entry e JOIN reachable r ON e.entry_key=r.key WHERE e.bundle_id=bundle_key AND e.organization_id=tenant) SELECT 1 FROM public.work_template_copy_entry e WHERE e.bundle_id=bundle_key AND e.organization_id=tenant AND NOT EXISTS(SELECT 1 FROM reachable r WHERE r.key=e.entry_key)) THEN
  RAISE EXCEPTION 'Copy entries must belong to requested closure' USING ERRCODE='23514',CONSTRAINT='copy_bundle_closure'; END IF;
 FOR member IN SELECT e.entry_key,e.ordinal,e.live_work_type_id,e.destination_work_type_id,e.reserved_first_version_id,e.consumed_version_id,e.reservation_state,e.after_state_fingerprint,e.dependency_entry_keys
   FROM public.work_template_copy_entry e WHERE e.bundle_id=bundle_key AND e.organization_id=tenant LOOP
  IF member.after_state_fingerprint IS NULL OR member.ordinal>=total
   OR cardinality(member.dependency_entry_keys)>(total-1)
   OR cardinality(member.dependency_entry_keys)<>(SELECT count(DISTINCT dependency.value) FROM unnest(member.dependency_entry_keys) dependency(value))
   OR EXISTS(SELECT 1 FROM unnest(member.dependency_entry_keys) dependency(value) WHERE NOT EXISTS(
      SELECT 1 FROM public.work_template_copy_entry e WHERE e.bundle_id=bundle_key AND e.organization_id=tenant AND e.entry_key=dependency.value AND e.ordinal<member.ordinal))
   OR (owning.state='installed' AND member.reservation_state='void')
   OR (owning.mode='published' AND member.reservation_state='pending')
   OR (owning.receipt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.change_set_entry c WHERE c.change_set_id=owning.receipt_id AND c.entity_kind='template' AND c.entity_id=member.destination_work_type_id AND c.op='create'))
   OR (member.reservation_state='void' AND (member.live_work_type_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.template t WHERE t.id=member.destination_work_type_id)))
   OR (member.reservation_state<>'void' AND member.live_work_type_id IS NULL)
   OR (member.reservation_state='pending' AND (member.consumed_version_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.work_type_version v WHERE v.work_type_id=member.destination_work_type_id) OR EXISTS(SELECT 1 FROM public.template t WHERE t.id=member.destination_work_type_id AND t.scope='organization')))
   OR (member.reservation_state='consumed' AND (member.consumed_version_id IS DISTINCT FROM member.reserved_first_version_id OR NOT EXISTS(
      SELECT 1 FROM public.work_type_version v WHERE v.id=member.consumed_version_id AND v.work_type_id=member.destination_work_type_id AND v.organization_id=tenant AND v.number=1))) THEN
   RAISE EXCEPTION 'Incomplete copy reservation' USING ERRCODE='23514',CONSTRAINT='copy_entry_complete'; END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_deferred_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='work_template_copy_bundle' THEN PERFORM public.docket_copy_commit_bundle(NEW.id,NEW.organization_id);
 ELSE PERFORM public.docket_copy_commit_bundle(NEW.bundle_id,NEW.organization_id); END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER copy_bundle_complete AFTER INSERT OR UPDATE ON work_template_copy_bundle DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION docket_copy_deferred_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER copy_entry_complete AFTER INSERT OR UPDATE ON work_template_copy_entry DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION docket_copy_deferred_guard();
--> statement-breakpoint
CREATE FUNCTION docket_copy_template_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE reservation record; accepting record;
BEGIN
 PERFORM public.docket_copy_identity_lock(ARRAY[NEW.id]);
 IF EXISTS(SELECT 1 FROM public.work_template_copy_entry e WHERE e.reserved_first_version_id=NEW.id)
 OR EXISTS(SELECT 1 FROM public.work_type_version v WHERE v.id=NEW.id) THEN
  RAISE EXCEPTION 'Template identity is reserved' USING ERRCODE='23514',CONSTRAINT='copy_identity_unique'; END IF;
 SELECT e.organization_id,e.bundle_id,e.target_type,e.reservation_state,e.live_work_type_id INTO reservation
 FROM public.work_template_copy_entry e WHERE e.destination_work_type_id=NEW.id FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT b.accepting_actor_id,b.state INTO accepting FROM public.work_template_copy_bundle b WHERE b.id=reservation.bundle_id;
 IF reservation.organization_id<>NEW.organization_id OR reservation.reservation_state<>'pending' OR reservation.live_work_type_id IS DISTINCT FROM NEW.id
   OR accepting.state<>'installing' OR NOT public.docket_copy_author(NEW.organization_id,accepting.accepting_actor_id)
   OR NEW.owner_actor_id IS DISTINCT FROM accepting.accepting_actor_id OR NEW.created_by IS DISTINCT FROM accepting.accepting_actor_id
   OR NEW.target_type IS DISTINCT FROM reservation.target_type OR NEW.scope<>'personal' OR NEW.latest_published_version_id IS NOT NULL OR NEW.is_base THEN
  RAISE EXCEPTION 'Template creation requires its current accepting reservation author' USING ERRCODE='23514',CONSTRAINT='copy_template_author'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER copy_template_identity BEFORE INSERT ON template FOR EACH ROW EXECUTE FUNCTION docket_copy_template_identity_guard();
--> statement-breakpoint
CREATE FUNCTION docket_copy_template_visible(tenant text,template_key text,actor_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.docket_copy_author(tenant,actor_key) AND EXISTS(SELECT 1 FROM public.template t
 WHERE t.id=template_key AND t.organization_id=tenant AND
 ((t.scope='personal' AND t.owner_actor_id=actor_key) OR
  (t.scope='organization' AND (t.latest_published_version_id IS NOT NULL OR t.owner_actor_id=actor_key)) OR
  (t.scope='team' AND EXISTS(SELECT 1 FROM public.team_member m WHERE m.organization_id=tenant AND m.team_id=t.team_id AND m.actor_id=actor_key))))
$$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_publication_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE reservation record; publication_actor text; installing_mode text;
BEGIN
 PERFORM public.docket_copy_identity_lock(ARRAY[NEW.id,NEW.work_type_id]);
 IF EXISTS(SELECT 1 FROM public.work_template_copy_entry e WHERE e.destination_work_type_id=NEW.id)
   OR EXISTS(SELECT 1 FROM public.template t WHERE t.id=NEW.id) THEN
  RAISE EXCEPTION 'Publication identity is allocated' USING ERRCODE='23514',CONSTRAINT='copy_identity_unique'; END IF;
 IF EXISTS(SELECT 1 FROM public.work_template_copy_entry e WHERE e.reserved_first_version_id=NEW.id AND (e.organization_id<>NEW.organization_id OR e.destination_work_type_id<>NEW.work_type_id OR NEW.number<>1 OR e.reservation_state<>'pending')) THEN
  RAISE EXCEPTION 'Publication identity belongs to another reservation' USING ERRCODE='23514',CONSTRAINT='copy_identity_unique'; END IF;
 SELECT e.id,e.organization_id,e.destination_work_type_id,e.reserved_first_version_id,e.reservation_state
 INTO reservation FROM public.work_template_copy_entry e WHERE e.destination_work_type_id=NEW.work_type_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 publication_actor:=nullif(current_setting('docket.actor_id',true),'');
 SELECT b.mode INTO installing_mode FROM public.work_template_copy_bundle b JOIN public.work_template_copy_entry e ON e.bundle_id=b.id WHERE e.id=reservation.id AND (b.state='installing' OR b.installation_transaction_id=pg_current_xact_id()::text);
 IF reservation.organization_id<>NEW.organization_id OR reservation.destination_work_type_id<>NEW.work_type_id
   OR reservation.reservation_state='void' OR installing_mode='private_drafts'
   OR (NEW.number=1 AND (NOT public.docket_copy_author(NEW.organization_id,publication_actor) OR NEW.published_by_actor_id IS DISTINCT FROM publication_actor))
   OR (NEW.number=1 AND (reservation.reservation_state<>'pending' OR NEW.id<>reservation.reserved_first_version_id))
   OR (NEW.number>1 AND (reservation.reservation_state<>'consumed' OR NEW.id=reservation.reserved_first_version_id)) THEN
  RAISE EXCEPTION 'Publication requires a lawful reserved identity and current author' USING ERRCODE='23514',CONSTRAINT='copy_publication_identity'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER copy_publication_identity BEFORE INSERT ON work_type_version FOR EACH ROW EXECUTE FUNCTION docket_copy_publication_identity_guard();
--> statement-breakpoint
CREATE FUNCTION docket_copy_consume_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.work_template_copy_entry e SET reservation_state='consumed',consumed_version_id=NEW.id
 WHERE e.organization_id=NEW.organization_id AND e.destination_work_type_id=NEW.work_type_id
 AND e.reserved_first_version_id=NEW.id AND e.reservation_state='pending' AND NEW.number=1;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER copy_consume_publication AFTER INSERT ON work_type_version FOR EACH ROW EXECUTE FUNCTION docket_copy_consume_publication();
--> statement-breakpoint
CREATE FUNCTION docket_template_copy_reservation(tenant text,template_key text)
RETURNS TABLE(entry_id text,reserved_first_version_id text,reservation_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.work_template_copy_entry e WHERE e.organization_id=tenant AND e.destination_work_type_id=template_key) THEN RETURN; END IF;
 IF NOT public.docket_copy_template_visible(tenant,template_key,nullif(current_setting('docket.actor_id',true),'')) THEN
  RAISE EXCEPTION 'Template not available' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.id,e.reserved_first_version_id,e.reservation_state FROM public.work_template_copy_entry e
 WHERE e.organization_id=tenant AND e.destination_work_type_id=template_key;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_template_copy_reservation(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION docket_template_copy_reservation(text,text) TO CURRENT_USER;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_commit_bundle(text,text) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_entry_guard() OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
ALTER FUNCTION docket_copy_bundle_guard() OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
ALTER FUNCTION docket_copy_commit_bundle(text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
ALTER FUNCTION docket_copy_deferred_guard() OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
ALTER FUNCTION docket_copy_template_identity_guard() OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
ALTER FUNCTION docket_copy_publication_identity_guard() OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
ALTER FUNCTION docket_copy_consume_publication() OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
ALTER FUNCTION docket_template_copy_reservation(text,text) OWNER TO docket_template_copy_integrity;

--> statement-breakpoint
ALTER FUNCTION docket_copy_active_actor(text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
ALTER FUNCTION docket_copy_acceptor_scope(text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
ALTER FUNCTION docket_copy_author(text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
ALTER FUNCTION docket_copy_template_visible(text,text,text) OWNER TO docket_template_copy_integrity;

--> statement-breakpoint
GRANT EXECUTE ON FUNCTION docket_template_copy_reservation(text,text) TO CURRENT_USER;

--> statement-breakpoint
CREATE FUNCTION docket_copy_scope_promotion_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.scope<>'organization' AND NEW.scope='organization' AND EXISTS(SELECT 1 FROM public.work_template_copy_entry e WHERE e.organization_id=OLD.organization_id AND e.destination_work_type_id=OLD.id AND e.reservation_state='pending')
 AND NOT public.docket_copy_template_visible(OLD.organization_id,OLD.id,nullif(current_setting('docket.actor_id',true),'')) THEN
  RAISE EXCEPTION 'Template not available' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER copy_scope_promotion BEFORE UPDATE ON template FOR EACH ROW EXECUTE FUNCTION docket_copy_scope_promotion_guard();
--> statement-breakpoint
ALTER FUNCTION docket_copy_scope_promotion_guard() OWNER TO docket_template_copy_integrity;

--> statement-breakpoint
CREATE FUNCTION docket_copy_destination_deferred_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE destination_key text; tenant_key text; reservation record;
BEGIN
 IF TG_OP='DELETE' THEN destination_key:=OLD.id;tenant_key:=OLD.organization_id;
 ELSE destination_key:=NEW.id;tenant_key:=NEW.organization_id; END IF;
 FOR reservation IN SELECT e.bundle_id FROM public.work_template_copy_entry e WHERE e.organization_id=tenant_key AND e.destination_work_type_id=destination_key LOOP
  PERFORM public.docket_copy_commit_bundle(reservation.bundle_id,tenant_key);
 END LOOP;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER copy_destination_complete AFTER UPDATE OR DELETE ON template DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION docket_copy_destination_deferred_guard();
--> statement-breakpoint
ALTER FUNCTION docket_copy_destination_deferred_guard() OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
-- Existence is not authoring or source authority; ordinary unreserved publication keeps its old path.
--> statement-breakpoint
CREATE FUNCTION docket_template_has_copy_reservation(tenant text,template_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.work_template_copy_entry e WHERE e.organization_id=tenant AND e.destination_work_type_id=template_key)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_template_has_copy_reservation(text,text) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_template_has_copy_reservation(text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION docket_template_has_copy_reservation(text,text) TO CURRENT_USER;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM docket_template_copy_integrity;
--> statement-breakpoint
REVOKE docket_template_copy_integrity FROM CURRENT_USER;
