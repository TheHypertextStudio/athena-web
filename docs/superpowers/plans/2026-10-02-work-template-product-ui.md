# Work-template product UI delivery

Reader: The implementing engineer. Implement this approved existing-flow slice and verify it in the authenticated app.

The user explicitly approved the October 2 plan for existing template and repeating-work behavior. Work-system state machines remain the long-term model; this delivery does not add their runtime or imply unsupported capabilities.

Use shared responsive-fullscreen dialogs with workspace width and viewport height. New templates use Basics, Work, Review. Existing templates open Work with direct section navigation. Repeat setup uses Work, Repeat, Review. Existing recurrence management content is shared by its direct route and the overlay.

Reuse the existing editor, composer regions, pickers, recurrence controls, APIs and permissions. Preserve draft values across steps and protect all changed metadata and settings on dismissal. Keep one content scroll owner and stable navigation/actions. Set field widths on containers and use shared surfaces and typography. No horizontal hairlines or example-specific product logic.

Validate all four work kinds, renamed templates, vocabulary changes, long names, empty/populated descriptions, dirty dismissal, failure retention, save/reopen, repeat creation, future revisions, pause/resume, history, and focus. Capture real desktop and phone layouts in both themes and check 320px overflow. Use existing UI verification commands and meaningful behavior tests. Commit on the feature branch after validation. Do not integrate or deploy.
