CREATE TABLE "athena_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"objective" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"active_session_id" text,
	"paused_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "athena_assignment_entity_type_check" CHECK ("athena_assignment"."entity_type" in ('initiative','project','task')),
	CONSTRAINT "athena_assignment_status_check" CHECK ("athena_assignment"."status" in ('active','paused','completed'))
);
--> statement-breakpoint
CREATE TABLE "athena_trigger" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"type" text NOT NULL,
	"event_kinds" text[] DEFAULT '{}' NOT NULL,
	"schedule_minutes" integer,
	"cooldown_minutes" integer DEFAULT 5 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "athena_trigger_type_check" CHECK ("athena_trigger"."type" in ('event','scheduled')),
	CONSTRAINT "athena_trigger_cooldown_check" CHECK ("athena_trigger"."cooldown_minutes" >= 5),
	CONSTRAINT "athena_trigger_shape_check" CHECK (("athena_trigger"."type" = 'event' AND "athena_trigger"."schedule_minutes" IS NULL AND cardinality("athena_trigger"."event_kinds") > 0)
        OR ("athena_trigger"."type" = 'scheduled' AND "athena_trigger"."schedule_minutes" >= 5 AND cardinality("athena_trigger"."event_kinds") = 0))
);
--> statement-breakpoint
CREATE TABLE "personal_mcp_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"alias" text NOT NULL,
	"url" text NOT NULL,
	"auth_mode" text NOT NULL,
	"status" "integration_status" DEFAULT 'pending' NOT NULL,
	"tool_count" integer,
	"last_error" text,
	"last_error_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "personal_mcp_connection_auth_mode_check" CHECK ("personal_mcp_connection"."auth_mode" in ('oauth','bearer','none'))
);
--> statement-breakpoint
CREATE TABLE "personal_mcp_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "athena_assignment_id_owner_uq" ON "athena_assignment" USING btree ("id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_mcp_connection_id_owner_uq" ON "personal_mcp_connection" USING btree ("id","owner_user_id");--> statement-breakpoint
ALTER TABLE "athena_assignment" ADD CONSTRAINT "athena_assignment_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_assignment" ADD CONSTRAINT "athena_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_assignment" ADD CONSTRAINT "athena_assignment_active_session_id_agent_session_id_fk" FOREIGN KEY ("active_session_id") REFERENCES "public"."agent_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_trigger" ADD CONSTRAINT "athena_trigger_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_trigger" ADD CONSTRAINT "athena_trigger_assignment_owner_fk" FOREIGN KEY ("assignment_id","owner_user_id") REFERENCES "public"."athena_assignment"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_mcp_connection" ADD CONSTRAINT "personal_mcp_connection_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_mcp_credential" ADD CONSTRAINT "personal_mcp_credential_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_mcp_credential" ADD CONSTRAINT "personal_mcp_credential_connection_owner_fk" FOREIGN KEY ("connection_id","owner_user_id") REFERENCES "public"."personal_mcp_connection"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "athena_assignment_owner_status_idx" ON "athena_assignment" USING btree ("owner_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "athena_assignment_target_idx" ON "athena_assignment" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "athena_trigger_owner_idx" ON "athena_trigger" USING btree ("owner_user_id","enabled");--> statement-breakpoint
CREATE INDEX "athena_trigger_schedule_idx" ON "athena_trigger" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_mcp_connection_owner_alias_uq" ON "personal_mcp_connection" USING btree ("owner_user_id","alias");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_mcp_connection_owner_url_uq" ON "personal_mcp_connection" USING btree ("owner_user_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_mcp_credential_connection_uq" ON "personal_mcp_credential" USING btree ("connection_id");
