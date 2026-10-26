# Project description and location

The approved general UI phase makes the existing description prominent, puts breadcrumbs above the header, and keeps the type label near the title. The existing rich-text description is the first Overview section, labeled Description. Updates and execution summaries follow it. No new field schema, custom properties, configurable tabs or inferred semantics are introduced.

Use the shared detail layout's eyebrow slot for a real location trail. A project with a resolved program links to Programs and that program; otherwise link to Projects. Do not present initiative associations as a single parent chain. Preserve workspace vocabulary and user-authored names. The title is not repeated in the breadcrumb.

The selected approach reorders the existing editor and adds navigation using saved references. A separate description tab would hide the context; promoting all metadata would repeat the form-heavy concept the user rejected. Existing summary, permission, autosave, contents navigation and work-type review remain intact.

On narrow panes, show only the immediate parent and let its name wrap rather than push the title/actions out of view. Wider panes keep the collection and parent trail. Loading reserves room for the breadcrumb. Validate actual editing/reload, empty and populated descriptions, long names, both themes and keyboard navigation. This approval covers local implementation, not integration or deployment.
