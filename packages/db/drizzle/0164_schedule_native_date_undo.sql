-- Undo may restore an explicit pin only through its persisted exact receipt.
-- The API reverses ownership and its work dates in one existing atomic undo transaction.
CREATE FUNCTION docket_native_schedule_date_undo_matches(tenant text,run_id text,previous jsonb,next_value jsonb)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM change_set_entry e JOIN change_set receipt ON receipt.id=e.change_set_id
    WHERE e.change_set_id=nullif(current_setting('docket.native_date_undo_entry',true),'')
      AND receipt.organization_id=tenant AND receipt.undone_at IS NULL
      AND e.entity_kind='native_schedule_date_ownership' AND e.op='update'
      AND e.entity_id=run_id || ':' || (previous->>'id') || ':' || (previous->>'field')
      AND e.before=jsonb_build_object('occurrenceId',run_id,'workKind',next_value->>'kind','workId',next_value->>'id','field',next_value->>'field','manual',next_value->'manual','lastDerivedDate',next_value->'lastDerivedDate')
      AND e.after=jsonb_build_object('occurrenceId',run_id,'workKind',previous->>'kind','workId',previous->>'id','field',previous->>'field','manual',previous->'manual','lastDerivedDate',previous->'lastDerivedDate')
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION docket_native_schedule_dates_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; expected jsonb; entry jsonb; previous jsonb; expected_sorted jsonb; actual_sorted jsonb;
BEGIN
  IF NEW.schedule_date_ownership IS NULL THEN
    IF TG_OP='UPDATE' AND OLD.schedule_date_ownership IS NOT NULL THEN RAISE EXCEPTION 'Native date ownership cannot be cleared' USING ERRCODE='23514',CONSTRAINT='schedule_dates_immutable'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.accepted_claim IS NULL OR NEW.blueprint_applied_at IS NULL OR NEW.blueprint_root_refs IS NULL OR NEW.run_kind<>'scheduled'
    OR jsonb_typeof(NEW.schedule_date_ownership)<>'array' OR jsonb_array_length(NEW.schedule_date_ownership)>500 THEN
    RAISE EXCEPTION 'Native dates require applied checked schedule work' USING ERRCODE='23514',CONSTRAINT='schedule_dates_shape';
  END IF;
  IF TG_OP='INSERT' OR OLD.schedule_date_ownership IS NULL THEN
    SELECT schedule_draft INTO document FROM recurrence_series_revision WHERE id=NEW.series_revision_id AND series_id=NEW.series_id AND organization_id=NEW.organization_id;
    IF document IS NULL THEN RAISE EXCEPTION 'Native dates require canonical revision' USING ERRCODE='23514',CONSTRAINT='schedule_dates_shape'; END IF;
    expected:=docket_native_schedule_date_policy(NEW.organization_id,document,NEW.blueprint_root_refs);
    SELECT jsonb_agg(value ORDER BY value->>'id',value->>'field') INTO expected_sorted FROM jsonb_array_elements(expected);
    SELECT jsonb_agg(value ORDER BY value->>'id',value->>'field') INTO actual_sorted FROM jsonb_array_elements(NEW.schedule_date_ownership);
    IF expected_sorted IS DISTINCT FROM actual_sorted THEN RAISE EXCEPTION 'Native dates differ from saved policy and actual work' USING ERRCODE='23514',CONSTRAINT='schedule_dates_registration'; END IF;
  ELSE
    SELECT jsonb_agg(value-'manual'-'lastDerivedDate' ORDER BY value->>'id',value->>'field') INTO expected_sorted FROM jsonb_array_elements(OLD.schedule_date_ownership);
    SELECT jsonb_agg(value-'manual'-'lastDerivedDate' ORDER BY value->>'id',value->>'field') INTO actual_sorted FROM jsonb_array_elements(NEW.schedule_date_ownership);
    IF expected_sorted IS DISTINCT FROM actual_sorted THEN RAISE EXCEPTION 'Native date policy is immutable' USING ERRCODE='23514',CONSTRAINT='schedule_dates_immutable'; END IF;
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(NEW.schedule_date_ownership) LOOP
    IF NOT docket_schedule_keys(entry,ARRAY['rootKey','path','kind','id','field','anchor','manual','lastDerivedDate'])
      OR jsonb_typeof(entry->'manual')<>'boolean' OR entry->>'field' IS DISTINCT FROM (CASE WHEN entry->>'kind'='task' THEN 'dueDate' ELSE 'targetDate' END)
      OR NOT (entry->'lastDerivedDate'='null'::jsonb OR (jsonb_typeof(entry->'lastDerivedDate')='string' AND entry->>'lastDerivedDate' ~ '^\d{4}-\d{2}-\d{2}$' AND (entry->>'lastDerivedDate')::date BETWEEN '1970-01-01'::date AND '2200-12-31'::date)) THEN
      RAISE EXCEPTION 'Malformed native date ownership' USING ERRCODE='23514',CONSTRAINT='schedule_dates_shape';
    END IF;
    IF TG_OP='UPDATE' AND OLD.schedule_date_ownership IS NOT NULL THEN
      SELECT value INTO previous FROM jsonb_array_elements(OLD.schedule_date_ownership) WHERE value->>'id'=entry->>'id' AND value->>'field'=entry->>'field';
      IF previous->'manual'='true'::jsonb AND entry->'manual'<>'true'::jsonb AND NOT docket_native_schedule_date_undo_matches(NEW.organization_id,NEW.id,previous,entry) THEN RAISE EXCEPTION 'Explicit native date pin cannot be released implicitly' USING ERRCODE='23514',CONSTRAINT='schedule_dates_manual'; END IF;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT (value->>'id',value->>'field'))<>count(*) FROM jsonb_array_elements(NEW.schedule_date_ownership)) THEN
    RAISE EXCEPTION 'Duplicate native date ownership' USING ERRCODE='23514',CONSTRAINT='schedule_dates_shape';
  END IF;
  RETURN NEW;
END $$;
