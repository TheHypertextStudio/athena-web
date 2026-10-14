# Template and repeat layout correction

Reader: A Docket maintainer reviewing the corrected real-app setup before integration.

The rejected desktop layout wasted space and obscured editing. The earlier audits' passing
verdicts are withdrawn. Desktop template setup now fits its content within the viewport limit;
phones retain the full screen. Settings follow their identity fields, and the document has a
shared field surface. Repeat setup exposes cadence fields directly.

## Evidence

The repository's authenticated dev-session and capture-shots tools captured persisted local
fixtures under `.data/design-review/2026-10-04-work-layout/`. These are test accounts, not
production acceptance. `work`, `basics`, `review`, `repeat`, `repeat-review`, `management`, and
`repeat-cadence-final` contain both themes at 1440×900, 390×844, 320×844, and 390×600.
`empty` and `long` cover desktop, phone, and 320px in both themes. `sharing` shows the open menu.
The earlier `repeat-cadence` folder predates the final interval-unit correction; use
`repeat-cadence-final` for that step.

The short Running a business Work screen measures 896×542, compared with the rejected
1152×876 panel. All four outline headings remain visible. The long finance-review document
reaches the height cap and scrolls through one body owner while Save changes remains visible.
The repeat step uses a 672px desktop width and displays “Every 1 month.”

## Craft assessment

The scores assess this correction. They do not establish usability for every work system.

| Dimension           | Score | Evidence                                                                                                                                                       |
| ------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand and voice     | 3     | Shared app surfaces, workspace vocabulary, concrete field labels, and action names replace the detached presentation.                                          |
| Typography          | 3     | Shared title/label/body tokens distinguish identity, settings, and authored document headings. Long template titles wrap instead of colliding with navigation. |
| Spatial rhythm      | 3     | Work's document and footer are adjacent; fields share container edges. Desktop height follows content rather than leaving hundreds of unused pixels.           |
| Hierarchy           | 3     | Basics, Work, and Review have distinct jobs. Repeat cadence is directly editable; uncommon controls remain under More options.                                 |
| Color               | 3     | Existing semantic tokens and shared surfaces retain both-theme parity. Primary-action contrast is checked in the browser.                                      |
| Motion and feedback | 3     | Shared dialog focus and motion remain intact. Pending saves disable editing, and failed saves retain drafts with application-owned errors.                     |
| States              | 3     | Tests cover all four kinds, renamed templates, changed vocabulary, sharing, empty descriptions, long content, permission failures, and save failures.          |
| Detail              | 3     | 320px captures have no horizontal overflow. Short-phone interaction checks reach expanded advanced controls and the last upcoming occurrence above the footer. |

## Gates and limits

Responsive and theme gates have fresh captures. No control added here lacks persisted behavior.
Keyboard dismissal and focus restoration have browser coverage. Touch primary actions measure
at least 40px, and their rendered text/background contrast is at least 4.5:1 in both themes.
Shared primitives retain their existing motion and accessible controls. This is focused
accessibility evidence, not a full assistive-technology audit.

The revised screens are ready for owner review. Screenshot inspection alone cannot prove that
the flow is intuitive; the previous audits incorrectly treated technical fit as sufficient.
Corporation-scale performance, nested work definitions, publishing, graph changes, autosave,
and reload recovery remain outside this delivery.

## Decisions and corrections

The shared responsive dialog retained phone bottom/right insets on desktop. Resetting those
insets fixes content-height sizing without adding another dialog implementation. Optional
composer form presentation preserves ordinary composer behavior.

The editor adds a final empty paragraph after Markdown lists. Dirty comparison now ignores
trailing line breaks so opening a saved document does not trigger false discard confirmation.
It still protects authored text changes and does not rewrite the saved document.

The independent product review identified the missing interval unit and two short-phone
reachability checks. The correction names the unit and verifies both scroll paths. The
engineering review required preservation of ordinary fields, popovers, focus, and disabled
behavior; owning tests cover those contracts.
