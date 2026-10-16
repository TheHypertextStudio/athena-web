ALTER TABLE "work_template_copy_entry" ADD COLUMN "reference_epoch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_template_copy_entry" ADD CONSTRAINT "copy_entry_reference_epoch" CHECK ("work_template_copy_entry"."reference_epoch" >= 0);
--> statement-breakpoint
-- Revalidate the narrow preexisting owner before any privilege extension.
--> statement-breakpoint
-- Only the bootstrap superuser may retain an ADMIN-only grant to this migration creator.
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
GRANT USAGE,CREATE ON SCHEMA public TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT docket_template_copy_integrity TO CURRENT_USER GRANTED BY CURRENT_USER;
--> statement-breakpoint
GRANT SELECT(reference_epoch),UPDATE(reference_epoch) ON work_template_copy_entry TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(draft_definition,target_type),UPDATE(id) ON template TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(organization_id,status,document) ON plan_draft TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(organization_id,expires_at,payload) ON composer_draft TO docket_template_copy_integrity;
--> statement-breakpoint
GRANT SELECT(organization_id,template_id) ON task TO docket_template_copy_integrity;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_copy_entry_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE owning record; identity_key text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.organization o WHERE o.id=OLD.organization_id) THEN
   RAISE EXCEPTION 'Copy reservation tombstones cannot be deleted' USING ERRCODE='23514',CONSTRAINT='copy_entry_immutable'; END IF;
  RETURN OLD;
 END IF;
 SELECT b.state,b.accepting_actor_id INTO STRICT owning FROM public.work_template_copy_bundle b WHERE b.id=NEW.bundle_id AND b.organization_id=NEW.organization_id;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['live_work_type_id','reservation_state','consumed_version_id','after_state_fingerprint','reference_epoch']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['live_work_type_id','reservation_state','consumed_version_id','after_state_fingerprint','reference_epoch'])
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
CREATE FUNCTION docket_copy_epoch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.reference_epoch<>0 THEN RAISE EXCEPTION 'Invalid reference epoch' USING ERRCODE='23514'; END IF;
 ELSIF NEW.reference_epoch IS DISTINCT FROM OLD.reference_epoch THEN
  IF current_user<>'docket_template_copy_integrity' OR OLD.reservation_state<>'pending'
    OR NEW.reference_epoch<>OLD.reference_epoch+1
    OR (to_jsonb(NEW)-'reference_epoch') IS DISTINCT FROM (to_jsonb(OLD)-'reference_epoch') THEN
   RAISE EXCEPTION 'Reference epoch is internal' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER copy_entry_00_epoch BEFORE INSERT OR UPDATE ON work_template_copy_entry FOR EACH ROW EXECUTE FUNCTION docket_copy_epoch_guard();
--> statement-breakpoint
CREATE FUNCTION docket_copy_references(source_kind text,document jsonb)
RETURNS TABLE(work_type_id text,version_id text,target_kind text)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT DISTINCT refs.work_type_id,refs.version_id,refs.target_kind FROM (
 SELECT node.value->>'templateId',node.value->>'workTypeVersionId',node.value->>'kind'
 FROM jsonb_array_elements(CASE WHEN source_kind='plan' THEN coalesce(document->'nodes','[]'::jsonb) ELSE '[]'::jsonb END) node(value)
 UNION ALL SELECT document->>'workTypeId',document->>'workTypeVersionId',document->>'kind' WHERE source_kind='composer'
 UNION ALL SELECT step.value->'template'->>'workTypeId',CASE WHEN step.value->'template'->'selection'->>'kind'='pinned' THEN step.value->'template'->'selection'->>'workTypeVersionId' END,step.value->>'kind'
 FROM jsonb_array_elements(CASE WHEN source_kind='definition' THEN coalesce(document->'blueprint'->'steps','[]'::jsonb) ELSE '[]'::jsonb END) step(value)
 UNION ALL SELECT schedule.value->'template'->>'workTypeId',CASE WHEN schedule.value->'template'->'selection'->>'kind'='pinned' THEN schedule.value->'template'->'selection'->>'workTypeVersionId' END,schedule.value->'template'->>'targetType'
 FROM jsonb_array_elements(CASE WHEN source_kind='definition' THEN coalesce(document->'defaultSchedules','[]'::jsonb) ELSE '[]'::jsonb END) schedule(value)
 UNION ALL SELECT document->>'templateId',NULL::text,'task'::text WHERE source_kind='task'
 ) refs(work_type_id,version_id,target_kind) WHERE refs.work_type_id IS NOT NULL
$$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_definition_view(tenant text,template_key text,actor_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.docket_copy_acceptor_scope(tenant,actor_key) AND EXISTS(SELECT 1 FROM public.template t
 WHERE t.organization_id=tenant AND t.id=template_key AND
 ((t.scope='personal' AND t.owner_actor_id=actor_key) OR
 (t.scope='organization' AND (t.latest_published_version_id IS NOT NULL OR t.owner_actor_id=actor_key)) OR
 (t.scope='team' AND EXISTS(SELECT 1 FROM public.team_member m WHERE m.organization_id=tenant AND m.team_id=t.team_id AND m.actor_id=actor_key))))
$$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_reference_exists(tenant text,template_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.task w WHERE w.organization_id=tenant AND w.template_id=template_key)
 OR EXISTS(SELECT 1 FROM public.plan_draft d CROSS JOIN LATERAL public.docket_copy_references('plan',d.document) r WHERE d.organization_id=tenant AND d.status='active' AND r.work_type_id=template_key)
 OR EXISTS(SELECT 1 FROM public.composer_draft d CROSS JOIN LATERAL public.docket_copy_references('composer',d.payload) r WHERE d.organization_id=tenant AND d.expires_at>now() AND r.work_type_id=template_key)
 OR EXISTS(SELECT 1 FROM public.template d CROSS JOIN LATERAL public.docket_copy_references('definition',d.draft_definition) r WHERE d.organization_id=tenant AND r.work_type_id=template_key)
$$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_template_in_use(tenant text,template_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.docket_copy_template_visible(tenant,template_key,nullif(current_setting('docket.actor_id',true),'')) THEN
 RAISE EXCEPTION 'Template not available' USING ERRCODE='42501'; END IF;
 RETURN public.docket_copy_reference_exists(tenant,template_key);
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_bundle_member_in_use(tenant text,bundle_key text,entry_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member_target text;
BEGIN
 IF NOT public.docket_copy_author(tenant,nullif(current_setting('docket.actor_id',true),'')) THEN RAISE EXCEPTION 'Copy not available' USING ERRCODE='42501'; END IF;
 SELECT e.destination_work_type_id INTO member_target FROM public.work_template_copy_entry e JOIN public.work_template_copy_bundle b ON b.id=e.bundle_id AND b.organization_id=e.organization_id
 WHERE b.organization_id=tenant AND b.id=bundle_key AND b.state='installed' AND b.accepting_actor_id=nullif(current_setting('docket.actor_id',true),'')
 AND b.receipt_key IS NOT NULL AND e.entry_key=docket_copy_bundle_member_in_use.entry_key;
 IF NOT FOUND OR NOT public.docket_copy_template_visible(tenant,member_target,nullif(current_setting('docket.actor_id',true),'')) THEN RAISE EXCEPTION 'Copy not available' USING ERRCODE='42501'; END IF;
 RETURN public.docket_copy_reference_exists(tenant,member_target);
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_template_copy_pending_selection(tenant text,template_key text)
RETURNS TABLE(reserved_first_version_id text,reservation_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.docket_copy_definition_view(tenant,template_key,nullif(current_setting('docket.actor_id',true),'')) THEN RAISE EXCEPTION 'Template not available' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.reserved_first_version_id,e.reservation_state FROM public.work_template_copy_entry e WHERE e.organization_id=tenant AND e.live_work_type_id=template_key AND e.reservation_state='pending';
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_receipt_registered(tenant text,receipt_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.docket_copy_acceptor_scope(tenant,nullif(current_setting('docket.actor_id',true),'')) THEN RAISE EXCEPTION 'Workspace not available' USING ERRCODE='42501'; END IF;
 RETURN EXISTS(SELECT 1 FROM public.work_template_copy_bundle b WHERE b.organization_id=tenant AND b.receipt_key=docket_copy_receipt_registered.receipt_key);
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_change_set_has_copy_bundle(tenant text,receipt_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.work_template_copy_bundle b WHERE b.organization_id=tenant AND b.receipt_key=docket_change_set_has_copy_bundle.receipt_key)
$$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_validate_reference(tenant text,template_key text,pin text,kind_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target_kind text;
BEGIN
 SELECT t.target_type::text INTO target_kind FROM public.template t WHERE t.organization_id=tenant AND t.id=template_key FOR KEY SHARE;
 IF NOT FOUND OR target_kind IS DISTINCT FROM kind_key OR (pin IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM public.work_type_version v WHERE v.organization_id=tenant AND v.work_type_id=template_key AND v.id=pin) AND NOT EXISTS(
 SELECT 1 FROM public.work_template_copy_entry e WHERE e.organization_id=tenant AND e.live_work_type_id=template_key AND e.reserved_first_version_id=pin AND e.reservation_state='pending')) THEN
 RAISE EXCEPTION 'Template selection is no longer available' USING ERRCODE='23503',CONSTRAINT='copy_reference_target'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_lock_references(tenant text,new_refs jsonb,old_refs jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE changed_refs jsonb; entry_row record; ref_row record;
BEGIN
 SELECT coalesce(jsonb_agg(n.value),'[]'::jsonb) INTO changed_refs FROM jsonb_array_elements(new_refs) n(value) WHERE NOT old_refs @> jsonb_build_array(n.value);
 FOR entry_row IN SELECT e.id FROM public.work_template_copy_entry e WHERE e.organization_id=tenant AND e.reservation_state='pending'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(changed_refs) r(value) WHERE r.value->>'work_type_id'=e.destination_work_type_id)
 ORDER BY e.destination_work_type_id,e.id LOOP
 UPDATE public.work_template_copy_entry SET reference_epoch=reference_epoch+1 WHERE id=entry_row.id AND reservation_state='pending';
 END LOOP;
 FOR ref_row IN SELECT r.value FROM jsonb_array_elements(changed_refs) r(value) ORDER BY r.value->>'work_type_id',r.value->>'version_id' LOOP
 PERFORM public.docket_copy_validate_reference(tenant,ref_row.value->>'work_type_id',ref_row.value->>'version_id',ref_row.value->>'target_kind');
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION docket_copy_reference_writer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source_kind text; new_document jsonb; old_document jsonb; new_live boolean:=true; old_live boolean:=false; new_refs jsonb; old_refs jsonb:='[]'::jsonb;
BEGIN
 IF TG_TABLE_NAME='plan_draft' THEN
 source_kind:='plan';new_document:=NEW.document;new_live:=NEW.status='active';
 IF TG_OP='UPDATE' THEN old_document:=OLD.document;old_live:=OLD.status='active' AND OLD.organization_id=NEW.organization_id; END IF;
 ELSIF TG_TABLE_NAME='composer_draft' THEN
 source_kind:='composer';new_document:=NEW.payload;new_live:=NEW.expires_at>now();
 IF TG_OP='UPDATE' THEN old_document:=OLD.payload;old_live:=OLD.expires_at>now() AND OLD.expires_at=NEW.expires_at AND OLD.organization_id=NEW.organization_id; END IF;
 ELSIF TG_TABLE_NAME='template' THEN
 source_kind:='definition';new_document:=NEW.draft_definition;
 IF TG_OP='UPDATE' THEN old_document:=OLD.draft_definition;old_live:=OLD.organization_id=NEW.organization_id; END IF;
 ELSE
 source_kind:='task';new_document:=jsonb_build_object('templateId',NEW.template_id);
 IF TG_OP='UPDATE' THEN old_document:=jsonb_build_object('templateId',OLD.template_id);old_live:=OLD.organization_id=NEW.organization_id; END IF;
 END IF;
 IF NOT new_live THEN RETURN NEW; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO new_refs FROM public.docket_copy_references(source_kind,new_document) r;
 IF old_live THEN SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO old_refs FROM public.docket_copy_references(source_kind,old_document) r; END IF;
 PERFORM public.docket_copy_lock_references(NEW.organization_id,new_refs,old_refs);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER copy_plan_reference BEFORE INSERT OR UPDATE ON plan_draft FOR EACH ROW EXECUTE FUNCTION docket_copy_reference_writer();
--> statement-breakpoint
CREATE TRIGGER copy_composer_reference BEFORE INSERT OR UPDATE ON composer_draft FOR EACH ROW EXECUTE FUNCTION docket_copy_reference_writer();
--> statement-breakpoint
CREATE TRIGGER copy_definition_reference BEFORE INSERT OR UPDATE ON template FOR EACH ROW EXECUTE FUNCTION docket_copy_reference_writer();
--> statement-breakpoint
CREATE TRIGGER copy_task_reference BEFORE INSERT OR UPDATE ON task FOR EACH ROW EXECUTE FUNCTION docket_copy_reference_writer();
--> statement-breakpoint
CREATE FUNCTION docket_copy_template_delete_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.organization o WHERE o.id=OLD.organization_id) AND public.docket_copy_reference_exists(OLD.organization_id,OLD.id) THEN
 RAISE EXCEPTION 'Template is in use' USING ERRCODE='23503',CONSTRAINT='copy_reference_target'; END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER copy_template_delete_references BEFORE DELETE ON template FOR EACH ROW EXECUTE FUNCTION docket_copy_template_delete_guard();
--> statement-breakpoint
ALTER FUNCTION docket_copy_template_delete_guard() OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_template_delete_guard() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_epoch_guard() OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_epoch_guard() FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_references(text,jsonb) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_references(text,jsonb) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_definition_view(text,text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_definition_view(text,text,text) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_reference_exists(text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_reference_exists(text,text) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_template_in_use(text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_template_in_use(text,text) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_bundle_member_in_use(text,text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_bundle_member_in_use(text,text,text) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_template_copy_pending_selection(text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_template_copy_pending_selection(text,text) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_receipt_registered(text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_receipt_registered(text,text) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_validate_reference(text,text,text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_validate_reference(text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_lock_references(text,jsonb,jsonb) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_lock_references(text,jsonb,jsonb) FROM PUBLIC;
--> statement-breakpoint
ALTER FUNCTION docket_copy_reference_writer() OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_copy_reference_writer() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION docket_copy_template_in_use(text,text) TO CURRENT_USER;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION docket_copy_bundle_member_in_use(text,text,text) TO CURRENT_USER;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION docket_template_copy_pending_selection(text,text) TO CURRENT_USER;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION docket_copy_receipt_registered(text,text) TO CURRENT_USER;
--> statement-breakpoint
ALTER FUNCTION docket_change_set_has_copy_bundle(text,text) OWNER TO docket_template_copy_integrity;
--> statement-breakpoint
REVOKE ALL ON FUNCTION docket_change_set_has_copy_bundle(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION docket_change_set_has_copy_bundle(text,text) TO CURRENT_USER;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM docket_template_copy_integrity;
--> statement-breakpoint
REVOKE docket_template_copy_integrity FROM CURRENT_USER GRANTED BY CURRENT_USER;
--> statement-breakpoint
-- PostgreSQL 16+ retains its bootstrap ADMIN-only creator grant, never runtime access.
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
  RAISE EXCEPTION 'Copy integrity role cleanup is not satisfied'; END IF;
END $$;
