CREATE TABLE "usage_daily" (
  "id" text PRIMARY KEY NOT NULL,
  "day" date NOT NULL,
  "user_id" text,
  "organization_id" text,
  "resource" text NOT NULL,
  "dimension" text DEFAULT '' NOT NULL,
  "quantity" bigint DEFAULT 0 NOT NULL,
  "unmeasured_events" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "usage_daily_key_uq" UNIQUE NULLS NOT DISTINCT (
    "day",
    "user_id",
    "organization_id",
    "resource",
    "dimension"
  ),
  CONSTRAINT "usage_daily_resource_check" CHECK (
    "usage_daily"."resource" IN (
      'ai_input_tokens',
      'ai_output_tokens',
      'ai_cache_read_tokens',
      'ai_cache_write_tokens',
      'postgres_bytes',
      'object_bytes'
    )
  ),
  CONSTRAINT "usage_daily_quantity_check" CHECK (
    "usage_daily"."quantity" >= 0
    AND "usage_daily"."unmeasured_events" >= 0
  )
);

--> statement-breakpoint
CREATE TABLE "usage_meter_run" (
  "meter" text PRIMARY KEY NOT NULL,
  "last_success_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone NOT NULL,
  "failed" boolean DEFAULT false NOT NULL,
  CONSTRAINT "usage_meter_run_meter_check" CHECK (
    "usage_meter_run"."meter" IN ('ai_tokens', 'postgres_storage', 'object_storage')
  )
);

--> statement-breakpoint
CREATE TABLE "usage_rate" (
  "id" text PRIMARY KEY NOT NULL,
  "resource" text NOT NULL,
  "dimension" text DEFAULT '' NOT NULL,
  "micros_per_million_units" bigint NOT NULL,
  "effective_from" timestamp with time zone NOT NULL,
  "note" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "usage_rate_resource_check" CHECK (
    "usage_rate"."resource" IN (
      'ai_input_tokens',
      'ai_output_tokens',
      'ai_cache_read_tokens',
      'ai_cache_write_tokens',
      'postgres_bytes',
      'object_bytes'
    )
  ),
  CONSTRAINT "usage_rate_price_check" CHECK ("usage_rate"."micros_per_million_units" >= 0)
);

--> statement-breakpoint
ALTER TABLE "usage_daily"
ADD CONSTRAINT "usage_daily_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE set null ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "usage_daily"
ADD CONSTRAINT "usage_daily_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization" ("id") ON DELETE set null ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE "usage_rate"
ADD CONSTRAINT "usage_rate_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user" ("id") ON DELETE set null ON UPDATE no action;

--> statement-breakpoint
CREATE INDEX "usage_daily_user_day_idx" ON "usage_daily" USING btree ("user_id", "day");

--> statement-breakpoint
CREATE INDEX "usage_daily_org_day_idx" ON "usage_daily" USING btree ("organization_id", "day");

--> statement-breakpoint
CREATE INDEX "usage_daily_day_idx" ON "usage_daily" USING btree ("day");

--> statement-breakpoint
CREATE UNIQUE INDEX "usage_rate_key_uq" ON "usage_rate" USING btree ("resource", "dimension", "effective_from");
