# User-defined work types: UI exploration

The types are user-defined. The current implementation is reusable templates
plus additional label-like metadata. This proposal and its interactive concepts
explore a future interface, not capabilities already shipped.

## Work identity and provenance

A quiet saved type name and icon can communicate what the work is. Template
version, capture, update and change operations explain where its starting
structure came from; put those in secondary controls. Preserve the distinction
between ongoing identity and creation provenance when the saved model differs.

Keep one coherent Docket detail layout. User-authored names, fields, sections and
empty prompts should make each definition meaningful without generating a new
application or inferring behavior from its name.

## Sample definitions

**Event** is an illustrative user-authored definition. Its author adds a date/time
field named Event time and sets the empty prompt to Set event time. Another
text/link field is named Venue or meeting link, with Add venue or meeting link as
its prompt. A Run of show section has an Add agenda item action. These labels
and actions belong to that definition, not to a built-in Event category.

**Product Launch** is another illustrative definition. Its author adds Audience
with Define launch audience as the empty prompt, and Release destination with
Add release destination. A Deliverables section offers Add launch deliverable.
No label or state implies that Docket can publish a release.

The work should read meaningfully before anyone fills in a document. Empty field
actions become editable values in the same locations after saving. Structured
facts lead; an optional brief supports them. Keep empty prompts concise and
specific to the next useful action rather than filling the page with setup cards.

## Definition customization

A deliberate Customize work type action opens the definition's name/icon,
field labels, empty prompts and section/add-action copy. Actions select a supported
operation such as editing the declared field or adding an item to that section;
writing a button label never creates a new execution capability.

The interactive concepts demonstrate filling and editing facts, adding section
items, opening Properties, and changing a definition's name and empty prompt.
Changing Event to a different user-authored name retains the configured fields
and behavior. Everything in the concepts is local sample state.

## Current delivery boundary

The approved implementation refines the existing project header: identity/actions
in one row, summary underneath, visible owner/status/health/dates, Properties for
supplemental context, and template provenance/actions in the project menu. It adds
no built-in types, rich custom-field contract, type-specific lifecycle or backend
architecture. The future empty-state concepts are a separate design deliverable.
