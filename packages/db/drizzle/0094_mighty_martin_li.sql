CREATE TYPE "public"."planning_date_resolution" AS ENUM('month', 'quarter', 'halfYear', 'year');--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "fiscal_year_start_month" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "target_date_resolution" "planning_date_resolution";--> statement-breakpoint
ALTER TABLE "initiative" ADD COLUMN "target_date_fiscal_year_start_month" integer;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "start_date_resolution" "planning_date_resolution";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "start_date_fiscal_year_start_month" integer;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "target_date_resolution" "planning_date_resolution";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "target_date_fiscal_year_start_month" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_fiscal_year_start_month_check" CHECK ("organization"."fiscal_year_start_month" >= 0 and "organization"."fiscal_year_start_month" <= 11);--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_target_timeframe_pair_check" CHECK ((
      ("initiative"."target_date_resolution" is null and "initiative"."target_date_fiscal_year_start_month" is null)
      or
      ("initiative"."target_date" is not null and "initiative"."target_date_resolution" is not null and "initiative"."target_date_fiscal_year_start_month" is not null and "initiative"."target_date_fiscal_year_start_month" between 0 and 11)
    ));--> statement-breakpoint
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_target_timeframe_boundary_check" CHECK ((
      "initiative"."target_date_resolution" is null
      or ("initiative"."target_date_resolution" = 'month' and "initiative"."target_date"::date = ((date_trunc('month', "initiative"."target_date") + make_interval(months => 1) - interval '1 day'))::date)
      or ("initiative"."target_date_resolution" = 'quarter' and "initiative"."target_date"::date = ((date_trunc('quarter', ("initiative"."target_date" - make_interval(months => "initiative"."target_date_fiscal_year_start_month"))) + make_interval(months => "initiative"."target_date_fiscal_year_start_month") + make_interval(months => 3) - interval '1 day'))::date)
      or ("initiative"."target_date_resolution" = 'halfYear' and "initiative"."target_date"::date = ((date_trunc('year', ("initiative"."target_date" - make_interval(months => "initiative"."target_date_fiscal_year_start_month"))) + make_interval(months => ((extract(month from ("initiative"."target_date" - make_interval(months => "initiative"."target_date_fiscal_year_start_month")))::int - 1) / 6) * 6 + "initiative"."target_date_fiscal_year_start_month") + make_interval(months => 6) - interval '1 day'))::date)
      or ("initiative"."target_date_resolution" = 'year' and "initiative"."target_date"::date = ((date_trunc('year', ("initiative"."target_date" - make_interval(months => "initiative"."target_date_fiscal_year_start_month"))) + make_interval(months => "initiative"."target_date_fiscal_year_start_month") + make_interval(months => 12) - interval '1 day'))::date)
    ));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_start_timeframe_pair_check" CHECK ((
      ("project"."start_date_resolution" is null and "project"."start_date_fiscal_year_start_month" is null)
      or
      ("project"."start_date" is not null and "project"."start_date_resolution" is not null and "project"."start_date_fiscal_year_start_month" is not null and "project"."start_date_fiscal_year_start_month" between 0 and 11)
    ));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_start_timeframe_boundary_check" CHECK ((
      "project"."start_date_resolution" is null
      or ("project"."start_date_resolution" = 'month' and "project"."start_date"::date = ((date_trunc('month', "project"."start_date")))::date)
      or ("project"."start_date_resolution" = 'quarter' and "project"."start_date"::date = ((date_trunc('quarter', ("project"."start_date" - make_interval(months => "project"."start_date_fiscal_year_start_month"))) + make_interval(months => "project"."start_date_fiscal_year_start_month")))::date)
      or ("project"."start_date_resolution" = 'halfYear' and "project"."start_date"::date = ((date_trunc('year', ("project"."start_date" - make_interval(months => "project"."start_date_fiscal_year_start_month"))) + make_interval(months => ((extract(month from ("project"."start_date" - make_interval(months => "project"."start_date_fiscal_year_start_month")))::int - 1) / 6) * 6 + "project"."start_date_fiscal_year_start_month")))::date)
      or ("project"."start_date_resolution" = 'year' and "project"."start_date"::date = ((date_trunc('year', ("project"."start_date" - make_interval(months => "project"."start_date_fiscal_year_start_month"))) + make_interval(months => "project"."start_date_fiscal_year_start_month")))::date)
    ));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_target_timeframe_pair_check" CHECK ((
      ("project"."target_date_resolution" is null and "project"."target_date_fiscal_year_start_month" is null)
      or
      ("project"."target_date" is not null and "project"."target_date_resolution" is not null and "project"."target_date_fiscal_year_start_month" is not null and "project"."target_date_fiscal_year_start_month" between 0 and 11)
    ));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_target_timeframe_boundary_check" CHECK ((
      "project"."target_date_resolution" is null
      or ("project"."target_date_resolution" = 'month' and "project"."target_date"::date = ((date_trunc('month', "project"."target_date") + make_interval(months => 1) - interval '1 day'))::date)
      or ("project"."target_date_resolution" = 'quarter' and "project"."target_date"::date = ((date_trunc('quarter', ("project"."target_date" - make_interval(months => "project"."target_date_fiscal_year_start_month"))) + make_interval(months => "project"."target_date_fiscal_year_start_month") + make_interval(months => 3) - interval '1 day'))::date)
      or ("project"."target_date_resolution" = 'halfYear' and "project"."target_date"::date = ((date_trunc('year', ("project"."target_date" - make_interval(months => "project"."target_date_fiscal_year_start_month"))) + make_interval(months => ((extract(month from ("project"."target_date" - make_interval(months => "project"."target_date_fiscal_year_start_month")))::int - 1) / 6) * 6 + "project"."target_date_fiscal_year_start_month") + make_interval(months => 6) - interval '1 day'))::date)
      or ("project"."target_date_resolution" = 'year' and "project"."target_date"::date = ((date_trunc('year', ("project"."target_date" - make_interval(months => "project"."target_date_fiscal_year_start_month"))) + make_interval(months => "project"."target_date_fiscal_year_start_month") + make_interval(months => 12) - interval '1 day'))::date)
    ));