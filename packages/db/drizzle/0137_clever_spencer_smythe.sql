CREATE TABLE "api_idempotency_receipt" (
	"user_id" text NOT NULL,
	"caller_namespace" text NOT NULL,
	"api_version" text NOT NULL,
	"key" text NOT NULL,
	"claim_id" text NOT NULL,
	"organization_id" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"receipt_format" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"response_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "idempotency_status" DEFAULT 'in_progress' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_idempotency_receipt_user_id_caller_namespace_api_version_key_pk" PRIMARY KEY("user_id","caller_namespace","api_version","key"),
	CONSTRAINT "api_idempotency_receipt_namespace_nonempty" CHECK (length(trim("api_idempotency_receipt"."caller_namespace")) > 0),
	CONSTRAINT "api_idempotency_receipt_version_nonempty" CHECK (length(trim("api_idempotency_receipt"."api_version")) > 0),
	CONSTRAINT "api_idempotency_receipt_claim_nonempty" CHECK (length(trim("api_idempotency_receipt"."claim_id")) > 0),
	CONSTRAINT "api_idempotency_receipt_format_check" CHECK ("api_idempotency_receipt"."receipt_format" IN ('legacy-json', 'json-receipt', 'atomic-receipt'))
);
--> statement-breakpoint
CREATE TABLE "work_schedule_aggregate_revision" (
	"hub_id" text PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedule_aggregate_revision_nonnegative" CHECK ("work_schedule_aggregate_revision"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "api_idempotency_receipt" ADD CONSTRAINT "api_idempotency_receipt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_aggregate_revision" ADD CONSTRAINT "work_schedule_aggregate_revision_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_idempotency_receipt_expires_idx" ON "api_idempotency_receipt" USING btree ("expires_at");
--> statement-breakpoint
INSERT INTO "api_idempotency_receipt" (
	"user_id", "caller_namespace", "api_version", "key", "claim_id", "organization_id",
	"method", "path", "request_hash", "receipt_format", "response_status", "response_body",
	"response_headers", "status", "expires_at", "created_at"
)
SELECT
	"user_id", 'session', '0.1.0', "key",
	'legacy-' || md5("user_id" || ':' || "key" || ':' || "created_at"::text),
	"organization_id", "method", "path", "request_hash", 'legacy-json', "response_status",
	"response_body", '{}'::jsonb, "status", "expires_at" AT TIME ZONE 'UTC',
	"created_at" AT TIME ZONE 'UTC'
FROM "idempotency_key"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "work_schedule_aggregate_revision" ("hub_id", "revision")
SELECT "hub_id", 1
FROM (
	SELECT "hub_id" FROM "work_schedule_plan"
	UNION
	SELECT "hub_id" FROM "work_schedule_exception"
) AS "existing_schedule"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION "advance_work_schedule_aggregate_revision"() RETURNS trigger AS $$
DECLARE
	target_hub_id text;
BEGIN
	target_hub_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.hub_id ELSE NEW.hub_id END;
	IF EXISTS (SELECT 1 FROM "hub" WHERE "id" = target_hub_id) THEN
		INSERT INTO "work_schedule_aggregate_revision" ("hub_id", "revision", "updated_at")
		VALUES (target_hub_id, 1, now())
		ON CONFLICT ("hub_id") DO UPDATE
		SET "revision" = "work_schedule_aggregate_revision"."revision" + 1,
			"updated_at" = now();
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "work_schedule_plan_revision_trigger"
	AFTER INSERT OR UPDATE OR DELETE ON "work_schedule_plan"
	FOR EACH ROW EXECUTE FUNCTION "advance_work_schedule_aggregate_revision"();
--> statement-breakpoint
CREATE TRIGGER "work_schedule_exception_revision_trigger"
	AFTER INSERT OR UPDATE OR DELETE ON "work_schedule_exception"
	FOR EACH ROW EXECUTE FUNCTION "advance_work_schedule_aggregate_revision"();
