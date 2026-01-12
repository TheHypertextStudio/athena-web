ALTER TYPE "integration_provider" ADD VALUE IF NOT EXISTS 'caldav_calendar';

UPDATE "linked_integrations"
SET "provider" = 'caldav_calendar'
WHERE "provider" = 'google_calendar'
  AND "external_account_id" LIKE 'http%';
