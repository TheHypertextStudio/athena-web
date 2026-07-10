-- Remove calendar caches whose funding OAuth account was already unlinked. Child calendar rows
-- cascade from calendar_connection, matching the user-visible unlink contract.
DELETE FROM "calendar_connection" AS "connection"
WHERE NOT EXISTS (
  SELECT 1
  FROM "account"
  WHERE "account"."user_id" = "connection"."user_id"
    AND "account"."provider_id" = "connection"."provider"
    AND "account"."account_id" = "connection"."external_account_id"
);--> statement-breakpoint

-- Better Auth treats one provider account as unique per Docket user. This key is also the
-- referenced side of the calendar_connection composite foreign key below.
CREATE UNIQUE INDEX "account_user_provider_external_uq"
ON "account" USING btree ("user_id", "provider_id", "account_id");--> statement-breakpoint

ALTER TABLE "calendar_connection"
ADD CONSTRAINT "calendar_connection_linked_account_fk"
FOREIGN KEY ("user_id", "provider", "external_account_id")
REFERENCES "public"."account"("user_id", "provider_id", "account_id")
ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Better Auth 1.6 encryption emits $ba$-prefixed bearer tokens. Null any older plaintext Google
-- token so it cannot remain stored after encryption is enabled; the account row stays linked and
-- the UI directs the user through incremental re-consent.
UPDATE "account"
SET
  "access_token" = CASE
    WHEN "access_token" LIKE '$ba$%' THEN "access_token"
    ELSE NULL
  END,
  "refresh_token" = CASE
    WHEN "refresh_token" LIKE '$ba$%' THEN "refresh_token"
    ELSE NULL
  END,
  "updated_at" = now()
WHERE "provider_id" = 'google'
  AND (
    ("access_token" IS NOT NULL AND "access_token" NOT LIKE '$ba$%')
    OR ("refresh_token" IS NOT NULL AND "refresh_token" NOT LIKE '$ba$%')
  );--> statement-breakpoint

UPDATE "calendar_connection" AS "connection"
SET
  "status" = 'reauth_required',
  "last_error" = 'Google account must be reauthorized after secure token storage was enabled',
  "updated_at" = now()
FROM "account"
WHERE "account"."user_id" = "connection"."user_id"
  AND "account"."provider_id" = "connection"."provider"
  AND "account"."account_id" = "connection"."external_account_id"
  AND "account"."provider_id" = 'google'
  AND "account"."access_token" IS NULL
  AND "account"."refresh_token" IS NULL;
