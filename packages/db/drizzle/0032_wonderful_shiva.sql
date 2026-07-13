CREATE TABLE "calendar_item_relation" (
	"source_item_id" text NOT NULL,
	"target_item_id" text NOT NULL,
	"role" text DEFAULT 'related' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_item_relation_source_item_id_target_item_id_pk" PRIMARY KEY("source_item_id","target_item_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_layer_share" (
	"layer_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"access" text DEFAULT 'details' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_layer_share_layer_id_organization_id_pk" PRIMARY KEY("layer_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_item_relation" ADD CONSTRAINT "calendar_item_relation_source_item_id_calendar_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."calendar_item"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_item_relation" ADD CONSTRAINT "calendar_item_relation_target_item_id_calendar_item_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."calendar_item"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_item_relation" ADD CONSTRAINT "calendar_item_relation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_layer_share" ADD CONSTRAINT "calendar_layer_share_layer_id_calendar_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."calendar_layer"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_layer_share" ADD CONSTRAINT "calendar_layer_share_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_layer_share" ADD CONSTRAINT "calendar_layer_share_created_by_actor_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "calendar_item_relation_target_idx" ON "calendar_item_relation" USING btree ("target_item_id");
--> statement-breakpoint
CREATE INDEX "calendar_layer_share_organization_idx" ON "calendar_layer_share" USING btree ("organization_id");
