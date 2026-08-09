# Open-document switcher design

**Date:** 2026-08-09
**Status:** Approved

## Objective

Make the tab bar's open-document control compact, searchable, and fully usable from the keyboard.
The overlay must not grow with long titles, must not spend a row on a redundant heading, and must
make focus movement obvious after the opener is clicked.

## Interaction model

The existing count-and-chevron control remains pinned at the end of the tab strip. Activating it,
or pressing Command+Shift+A on macOS or Control+Shift+A on Windows/Linux, opens one shared
controlled popover. The shortcut is global while the tab bar exists, ignores repeated keydown
events, and does not fire when Alt is held.

The popover opens with focus in a search field. The field is the visual header: a leading search
icon, the placeholder `Search open documents`, and a platform-appropriate shortcut hint distinguish
it from the results without adding an "Open documents" label. Filtering is immediate, local, and
case-insensitive against document titles. An unmatched query renders a quiet `No open documents
found` state without changing the open-tab collection.

Tab and Shift+Tab use ordinary browser focus order: search field, first document link, its close
button, the next result, and so on. Each stop has the shared visible inset focus indicator. Arrow
Down from the search field or a result advances between document links; Arrow Up reverses; Enter
on a document link navigates through the host's real link; Escape closes the popover and restores
focus to the count trigger. Closing a result does not navigate and leaves focus on the nearest
remaining result, or the search field when the list becomes empty.

## Geometry and visual treatment

The popover uses the design system's `xl` menu width: 352px, with the existing viewport clamp so it
fits a 320px device. This is a fixed ceiling rather than the current content-sized minimum, so long
document titles truncate inside the panel instead of widening it.

The search field sits in its own tonal well at the top of the popover, separated from the result
stack by spacing rather than a redundant section label. Results retain their type glyph, truncated
title, active-document tertiary-container treatment, and close action. Every row has 16px leading
and trailing inset. The close action occupies its 24px target inside that trailing inset and has no
extra end margin, producing balanced visible edges.

## Component boundary and data flow

`TabBar` continues to own no tab state. `OverflowMenu` may be renamed to reflect its popover
behavior, but it still receives the same `tabs`, `activeKey`, `renderLink`, and `onClose` contract.
It owns only transient overlay state, query text, and result focus. Search never calls the API.

The global shortcut is registered by the switcher while open documents exist and removed on
unmount. Opening from either pointer or keyboard follows the same state path. Navigation remains a
real host-rendered link so routing, prefetch, and open-in-new-context behavior do not fork.

## Accessibility and error handling

The trigger retains the accessible name `Open documents (N)`. The popover is labelled by its
search field rather than pretending that a compound interactive surface is an ARIA menu. Results
are a navigational list with separate, named `Close <title>` buttons. Focus is never placed on a
wrapper that cannot perform an action.

Because all data is local, the only empty conditions are no matches and closing the final result.
The tab bar already renders nothing when no documents exist, so the shortcut listener also
disappears in that state.

## Testing and validation

Component tests will establish the 352px ceiling, viewport clamp, removal of the heading, search
filtering, both shortcut modifiers, repeat/Alt rejection, initial search focus, Tab/Shift+Tab focus
order, Arrow navigation, Enter activation, Escape focus restoration, close focus recovery, active
state, and balanced row classes. The focused, active, hover, and empty states will be checked in
light and dark themes at desktop and narrow widths before repository validation.
