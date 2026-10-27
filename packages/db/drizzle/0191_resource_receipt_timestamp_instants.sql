-- Existing receipt values were authored as UTC wall clocks. Preserve those instants and
-- upgrade already-created staging tables without changing historical migration receipts.
ALTER TABLE "resource_write_receipt"
ALTER COLUMN "completed_at" TYPE timestamp with time zone USING "completed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';
