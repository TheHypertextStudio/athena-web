-- Unbind every column stored with the `notion_person` representation from its Notion property.
--
-- That representation used to provision the column as a Notion `people` property. It now
-- provisions as `rich_text`, with the native people property added BESIDE it as a derived
-- companion column — because a `people` property cannot hold anyone outside the Notion workspace,
-- so substituting it dropped every person without a Notion account from the database.
--
-- A stored binding still carrying its old `propertyId` points at a `people` property that would
-- now receive a rich-text payload, which Notion rejects. Clearing the id makes the next
-- provisioning pass re-issue the property; the representation itself is deliberately left alone,
-- since the user's choice has not changed — only how Docket honors it.
UPDATE "notion_mirror_database"
SET "property_map" = (
  SELECT jsonb_object_agg(
    key,
    CASE
      WHEN value->>'representation' = 'notion_person' THEN value - 'propertyId'
      ELSE value
    END
  )
  FROM jsonb_each("property_map")
)
-- The EXISTS guard is load-bearing, not an optimization: `jsonb_object_agg` over zero rows returns
-- NULL, so running this against a design with an empty property map would erase the column.
WHERE EXISTS (
  SELECT 1
  FROM jsonb_each("property_map") AS binding
  WHERE binding.value->>'representation' = 'notion_person'
    AND binding.value ? 'propertyId'
);
