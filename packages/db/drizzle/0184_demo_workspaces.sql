-- Demo workspaces: operator-created entry points that provision a copy of a source workspace
-- for people with operator-issued reviewer links. Adds the source flag on organizations and
-- the demo_sign_in kill switch. Grants no access by itself; the demo service decides sign-ins.
ALTER TABLE "organization"
ADD COLUMN "demo_source" boolean DEFAULT false NOT NULL;

--> statement-breakpoint
CREATE TABLE "demo" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "source_organization_id" text NOT NULL,
  "mode" text NOT NULL,
  "sign_in_token_hash" text,
  "allowed_emails" text[] DEFAULT '{}'::text[] NOT NULL,
  "allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL,
  "reset_cron" text,
  "workspace_ttl_days" integer,
  "expires_at" timestamp,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by_staff_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "demo_slug_format_check" CHECK (
    "demo"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length("demo"."slug") <= 64
  ),
  CONSTRAINT "demo_mode_check" CHECK ("demo"."mode" IN ('shared', 'per_person')),
  CONSTRAINT "demo_status_check" CHECK ("demo"."status" IN ('active', 'disabled')),
  CONSTRAINT "demo_workspace_ttl_check" CHECK (
    "demo"."workspace_ttl_days" IS NULL
    OR "demo"."workspace_ttl_days" > 0
  )
);

--> statement-breakpoint
CREATE TABLE "demo_workspace" (
  "id" text PRIMARY KEY NOT NULL,
  "demo_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "owner_user_id" text,
  "provisioned_at" timestamp DEFAULT now() NOT NULL,
  "last_reset_at" timestamp,
  "expires_at" timestamp
);

--> statement-breakpoint
ALTER TABLE "demo"
ADD CONSTRAINT "demo_source_organization_id_organization_id_fk" FOREIGN KEY ("source_organization_id") REFERENCES "public"."organization" ("id") ON DELETE restrict ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "demo"
ADD CONSTRAINT "demo_created_by_staff_id_staff_user_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_user" ("id") ON DELETE set null ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "demo_workspace"
ADD CONSTRAINT "demo_workspace_demo_id_demo_id_fk" FOREIGN KEY ("demo_id") REFERENCES "public"."demo" ("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "demo_workspace"
ADD CONSTRAINT "demo_workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization" ("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "demo_workspace"
ADD CONSTRAINT "demo_workspace_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user" ("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint
CREATE UNIQUE INDEX "demo_slug_uq" ON "demo" USING btree ("slug");

--> statement-breakpoint
CREATE UNIQUE INDEX "demo_workspace_org_uq" ON "demo_workspace" USING btree ("organization_id");

--> statement-breakpoint
CREATE INDEX "demo_workspace_demo_idx" ON "demo_workspace" USING btree ("demo_id");

--> statement-breakpoint
CREATE INDEX "demo_workspace_expires_idx" ON "demo_workspace" USING btree ("expires_at");

--> statement-breakpoint
CREATE UNIQUE INDEX "demo_workspace_shared_uq" ON "demo_workspace" USING btree ("demo_id")
WHERE
  "demo_workspace"."owner_user_id" IS NULL;

--> statement-breakpoint
CREATE UNIQUE INDEX "demo_workspace_owner_uq" ON "demo_workspace" USING btree ("demo_id", "owner_user_id")
WHERE
  "demo_workspace"."owner_user_id" IS NOT NULL;

--> statement-breakpoint
ALTER TABLE "service_control"
DROP CONSTRAINT "service_control_key_check";

--> statement-breakpoint
ALTER TABLE "service_control"
ADD CONSTRAINT "service_control_key_check" CHECK (
  "service_control"."key" IN (
    'lattice_submissions',
    'lattice_polling',
    'service_probes',
    'demo_sign_in'
  )
);
