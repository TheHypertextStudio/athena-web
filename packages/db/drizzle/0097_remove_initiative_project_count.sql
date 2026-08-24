CREATE FUNCTION docket_remove_initiative_project_count_filter(node jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
	kind text;
	cleaned_children jsonb;
	cleaned_child jsonb;
	child_count integer;
BEGIN
	IF node IS NULL OR node = 'null'::jsonb THEN
		RETURN NULL;
	END IF;

	kind := node->>'kind';
	IF kind = 'predicate' THEN
		IF node->>'field' = 'activeProjectCount' THEN
			RETURN NULL;
		END IF;
		RETURN node;
	END IF;

	IF kind = 'not' THEN
		cleaned_child := docket_remove_initiative_project_count_filter(node->'child');
		IF cleaned_child IS NULL THEN
			RETURN NULL;
		END IF;
		RETURN jsonb_build_object('kind', 'not', 'child', cleaned_child);
	END IF;

	IF kind IN ('all', 'any') THEN
		SELECT coalesce(jsonb_agg(cleaned.node ORDER BY cleaned.ordinal), '[]'::jsonb), count(*)::int
		INTO cleaned_children, child_count
		FROM (
			SELECT docket_remove_initiative_project_count_filter(item) AS node, ordinal
			FROM jsonb_array_elements(coalesce(node->'children', '[]'::jsonb))
				WITH ORDINALITY AS children(item, ordinal)
		) cleaned
		WHERE cleaned.node IS NOT NULL;

		IF child_count = 0 THEN
			RETURN NULL;
		END IF;
		IF child_count = 1 THEN
			RETURN cleaned_children->0;
		END IF;
		RETURN jsonb_build_object('kind', kind, 'children', cleaned_children);
	END IF;

	RETURN node;
END
$$;--> statement-breakpoint
CREATE FUNCTION docket_remove_initiative_project_count_definition(definition jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
	SELECT jsonb_set(
		jsonb_set(
			jsonb_set(
				definition,
				'{filter}',
				coalesce(
					docket_remove_initiative_project_count_filter(definition->'filter'),
					'null'::jsonb
				)
			),
			'{arrangement,orderBy}',
			coalesce((
				SELECT jsonb_agg(item ORDER BY ordinal)
				FROM jsonb_array_elements(definition#>'{arrangement,orderBy}')
					WITH ORDINALITY AS terms(item, ordinal)
				WHERE item->>'field' <> 'activeProjectCount'
			), '[]'::jsonb)
		),
		'{presentation,properties}',
		coalesce((
			SELECT jsonb_agg(item ORDER BY ordinal)
			FROM jsonb_array_elements(definition#>'{presentation,properties}')
				WITH ORDINALITY AS properties(item, ordinal)
			WHERE item <> '"activeProjectCount"'::jsonb
		), '[]'::jsonb)
	)
$$;--> statement-breakpoint
CREATE FUNCTION docket_remove_initiative_project_count_preference(state jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
	cleaned jsonb := state;
BEGIN
	IF state->>'target' <> 'initiative' THEN
		RETURN state;
	END IF;

	IF jsonb_typeof(state#>'{arrangement,orderBy}') = 'array' THEN
		cleaned := jsonb_set(cleaned, '{arrangement,orderBy}', coalesce((
			SELECT jsonb_agg(item ORDER BY ordinal)
			FROM jsonb_array_elements(state#>'{arrangement,orderBy}')
				WITH ORDINALITY AS terms(item, ordinal)
			WHERE item->>'field' <> 'activeProjectCount'
		), '[]'::jsonb));
	END IF;

	IF jsonb_typeof(state#>'{presentation,properties}') = 'array' THEN
		cleaned := jsonb_set(cleaned, '{presentation,properties}', coalesce((
			SELECT jsonb_agg(item ORDER BY ordinal)
			FROM jsonb_array_elements(state#>'{presentation,properties}')
				WITH ORDINALITY AS properties(item, ordinal)
			WHERE item <> '"activeProjectCount"'::jsonb
		), '[]'::jsonb));
	END IF;

	RETURN cleaned;
END
$$;--> statement-breakpoint
UPDATE "saved_view"
SET "definition" = docket_remove_initiative_project_count_definition("definition")
WHERE "target" = 'initiative';--> statement-breakpoint
UPDATE "organization_work_view_default"
SET "definition" = docket_remove_initiative_project_count_definition("definition")
WHERE "target" = 'initiative';--> statement-breakpoint
UPDATE "hub"
SET "preferences" = jsonb_set("preferences", '{viewState}', (
	SELECT coalesce(
		jsonb_agg(docket_remove_initiative_project_count_preference(state) ORDER BY ordinal),
		'[]'::jsonb
	)
	FROM jsonb_array_elements("preferences"->'viewState') WITH ORDINALITY AS states(state, ordinal)
))
WHERE jsonb_typeof("preferences"->'viewState') = 'array';--> statement-breakpoint
DROP FUNCTION docket_remove_initiative_project_count_preference(jsonb);--> statement-breakpoint
DROP FUNCTION docket_remove_initiative_project_count_definition(jsonb);--> statement-breakpoint
DROP FUNCTION docket_remove_initiative_project_count_filter(jsonb);
