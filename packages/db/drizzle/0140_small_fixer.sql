CREATE TABLE "source_person_reference" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"external_actor_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"field" text NOT NULL,
	"actor_id" text,
	"source_display_name" text NOT NULL,
	"detached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actor_alias" (
	"actor_id" text PRIMARY KEY NOT NULL,
	"canonical_actor_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"merged_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "person_actor_id" text;--> statement-breakpoint
ALTER TABLE "source_person_reference" ADD CONSTRAINT "source_person_reference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_person_reference" ADD CONSTRAINT "source_person_reference_external_actor_id_external_actor_id_fk" FOREIGN KEY ("external_actor_id") REFERENCES "public"."external_actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_person_reference" ADD CONSTRAINT "source_person_reference_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_alias" ADD CONSTRAINT "actor_alias_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_alias" ADD CONSTRAINT "actor_alias_canonical_actor_id_actor_id_fk" FOREIGN KEY ("canonical_actor_id") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_alias" ADD CONSTRAINT "actor_alias_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_alias" ADD CONSTRAINT "actor_alias_merged_by_actor_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_person_reference_uq" ON "source_person_reference" USING btree ("subject_type","subject_id","field","external_actor_id");--> statement-breakpoint
CREATE INDEX "source_person_reference_subject_idx" ON "source_person_reference" USING btree ("organization_id","subject_type","subject_id");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_person_actor_id_actor_id_fk" FOREIGN KEY ("person_actor_id") REFERENCES "public"."actor"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Assignment writes and consolidation must serialize on the referenced actor.
-- Otherwise a writer can validate the old ID before a merge and commit it afterward.
CREATE FUNCTION canonicalize_person_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  field_name text;
  person_id text;
  canonical_id text;
  replacement jsonb := to_jsonb(NEW);
BEGIN
  FOR person_id IN
    SELECT DISTINCT replacement ->> name FROM unnest(TG_ARGV) AS name
    WHERE replacement ->> name IS NOT NULL ORDER BY 1
  LOOP
    PERFORM 1 FROM actor WHERE id = person_id AND organization_id = NEW.organization_id FOR KEY SHARE;
  END LOOP;
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    person_id := replacement ->> field_name;
    IF person_id IS NULL THEN CONTINUE; END IF;
    LOOP
      PERFORM 1 FROM actor WHERE id = person_id AND organization_id = NEW.organization_id FOR KEY SHARE;
      SELECT canonical_actor_id INTO canonical_id FROM actor_alias
        WHERE actor_id = person_id AND organization_id = NEW.organization_id;
      EXIT WHEN canonical_id IS NULL;
      person_id := canonical_id;
    END LOOP;
    replacement := jsonb_set(replacement, ARRAY[field_name], to_jsonb(person_id));
  END LOOP;
  NEW := jsonb_populate_record(NEW, replacement);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER task_canonical_person BEFORE INSERT OR UPDATE OF assignee_id, delegate_id ON task
FOR EACH ROW EXECUTE FUNCTION canonicalize_person_assignment('assignee_id', 'delegate_id');
--> statement-breakpoint
CREATE TRIGGER project_canonical_person BEFORE INSERT OR UPDATE OF lead_id ON project
FOR EACH ROW EXECUTE FUNCTION canonicalize_person_assignment('lead_id');
--> statement-breakpoint
CREATE TRIGGER initiative_canonical_person BEFORE INSERT OR UPDATE OF owner_id ON initiative
FOR EACH ROW EXECUTE FUNCTION canonicalize_person_assignment('owner_id');
--> statement-breakpoint
CREATE TRIGGER program_canonical_person BEFORE INSERT OR UPDATE OF owner_id ON program
FOR EACH ROW EXECUTE FUNCTION canonicalize_person_assignment('owner_id');
--> statement-breakpoint
CREATE TRIGGER process_task_canonical_person BEFORE INSERT OR UPDATE OF assignee_id ON process_task_spec
FOR EACH ROW EXECUTE FUNCTION canonicalize_person_assignment('assignee_id');
--> statement-breakpoint
CREATE TRIGGER process_project_canonical_person BEFORE INSERT OR UPDATE OF lead_id ON process_project_spec
FOR EACH ROW EXECUTE FUNCTION canonicalize_person_assignment('lead_id');
--> statement-breakpoint
CREATE TRIGGER team_member_canonical_person BEFORE INSERT OR UPDATE OF actor_id ON team_member
FOR EACH ROW EXECUTE FUNCTION canonicalize_person_assignment('actor_id');
--> statement-breakpoint
CREATE TRIGGER project_member_canonical_person BEFORE INSERT OR UPDATE OF actor_id ON project_member
FOR EACH ROW EXECUTE FUNCTION canonicalize_person_assignment('actor_id');
