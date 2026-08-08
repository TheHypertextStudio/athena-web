-- The link between one inbound item (an email, a GitHub pull request, a Linear issue) and the task
-- an automation rule routed it to.
--
-- Additive and empty on arrival: nothing has routed yet, so there is nothing to backfill and no
-- table to rewrite. The unique index over (organization_id, source_system, source_key) is what
-- makes routing idempotent and makes a later event about the same item update the task the first
-- one created rather than file a second one beside it.
CREATE TABLE "inbound_task_route" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"task_id" text NOT NULL,
	"source_system" "source_system" NOT NULL,
	"source_key" text NOT NULL,
	"source_url" text,
	"source_integration_id" text,
	"origin_organization_id" text,
	CONSTRAINT "inbound_task_route_source_key_not_blank" CHECK ("inbound_task_route"."source_key" ~ '[^[:space:]]')
);
--> statement-breakpoint
ALTER TABLE "inbound_task_route" ADD CONSTRAINT "inbound_task_route_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_task_route" ADD CONSTRAINT "inbound_task_route_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_task_route" ADD CONSTRAINT "inbound_task_route_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_task_route" ADD CONSTRAINT "inbound_task_route_source_integration_id_integration_id_fk" FOREIGN KEY ("source_integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_task_route" ADD CONSTRAINT "inbound_task_route_origin_organization_id_organization_id_fk" FOREIGN KEY ("origin_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_task_route_source_uq" ON "inbound_task_route" USING btree ("organization_id","source_system","source_key");--> statement-breakpoint
CREATE INDEX "inbound_task_route_task_idx" ON "inbound_task_route" USING btree ("task_id");