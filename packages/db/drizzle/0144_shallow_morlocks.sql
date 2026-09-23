CREATE TABLE "daily_plan_day" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"date" date NOT NULL,
	"draft" jsonb,
	"accepted" jsonb,
	"resume_step" text DEFAULT 'review_yesterday' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_plan_review" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"decision" text NOT NULL,
	"target_date" date,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_plan_day" ADD CONSTRAINT "daily_plan_day_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_plan_review" ADD CONSTRAINT "daily_plan_review_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_plan_review" ADD CONSTRAINT "daily_plan_review_source_item_id_daily_plan_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."daily_plan_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_plan_day_hub_date_uq" ON "daily_plan_day" USING btree ("hub_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_plan_review_source_uq" ON "daily_plan_review" USING btree ("source_item_id");
