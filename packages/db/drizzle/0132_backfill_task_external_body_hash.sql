-- Anchor every linked task that is in step with its provider to the description it holds now.
-- A task with no anchor has its description sent on every push, which would replace a provider
-- page Docket only read in part with the partial copy. Tasks with unpushed edits keep no anchor, so
-- their descriptions still go out. The digest matches `descriptionHash` in the API: the first 32
-- hex characters of SHA-256 over the UTF-8 description, with a null description hashed as empty.
UPDATE "task"
SET "external_body_hash" = substr(encode(sha256(convert_to(coalesce("description", ''), 'UTF8')), 'hex'), 1, 32)
WHERE "source" = 'linked'
  AND "external_id" IS NOT NULL
  AND "external_body_hash" IS NULL
  AND "external_updated_at" IS NOT NULL
  AND "updated_at" <= "external_updated_at";
