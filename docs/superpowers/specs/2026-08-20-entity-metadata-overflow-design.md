# Entity metadata overflow design

The reader is the engineer maintaining strategic-work detail headers. They must keep the header
compact without repeating controls or creating a second property model.

## Decision

`EntityMetadataRow` will render the highest-priority properties that fit in its inline lane. Its
popover will render only the lower-priority properties that do not fit. The overflow trigger will
not render when every property fits. A property will never appear in both places at the same time.

The row will derive visibility from the row container, not the viewport. The existing priority
thresholds remain the policy. One measurement hook will convert the container width into the
highest visible priority. The React renderer will then partition the canonical child list. CSS
will no longer maintain a second visibility implementation.

The row will wrap both lanes in the existing `ControlGroup` at the `md` step. That step provides a
32px control height, 12px horizontal inset, an 18px icon, and the MD3 `label-large` type role.
Property triggers will stop overriding those metrics with `min-h-10`, local padding, or icon sizes.
The shared class will retain only surface, truncation, and shape behavior that the control primitive
does not own. No arbitrary value, inline style, or new type class will be added.

Initiatives will expose one health property in the masthead. The read-only rolled-up child-health
pill will leave the property row because it presents a second health-like value with unclear
authority. Connected-work rollups remain available in Initiative analysis. Initiative UI copy will
say `health`, `No health`, or `No health data`; it will not call health a verdict.

## Rejected approaches

The overflow will not render every property and rely on the user to remember which copy is
authoritative. That is the defect in the current surface.

The overflow will not mirror the container-query rules with inverse CSS. Radix renders popover
content in a portal, so the copy no longer shares the row's container context. Two threshold tables
would drift.

The Initiative header will not keep two health chips under different labels. Renaming `No verdict`
to `No health` would make the duplication worse rather than fix it.

## Validation

Component tests will resize the metadata row across the existing thresholds and assert that inline
and overflow property names are disjoint. They will assert that the overflow trigger disappears
when no property is hidden. Source-policy tests will reject `verdict` copy in Initiative production
components and reject arbitrary sizing classes in the shared metadata control. Browser validation
will cover 1440, 768, 390, and 320 pixels in both themes after the broader view release reaches its
page-switching stage.
