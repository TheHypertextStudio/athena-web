# Collapsed Navigation Recents Design

The reader is the Web and UI maintainer who must keep the collapsed shell useful without turning
it into a second full navigation tree. The collapsed rail will retain its six labeled MD3 daily
destinations. It will remove the generic More destination. A divider will introduce up to three
recent document shortcuts below the daily destinations. Each shortcut will use the document
type's primary icon in a 40 by 40 target. Its tooltip and accessible name will use the resolved
document title. The active recent document will use the selected tonal state.

The open-documents provider already observes every task, project, initiative, program, cycle, and
session detail route. It will own a separate most-recently-used list because open tabs and recent
navigation answer different questions. Visiting a document moves it to the front and deduplicates
its prior entry. The list retains three entries and persists per account in session storage.
Closing a tab does not delete its recent entry. A title resolved after navigation updates both the
tab and its recent shortcut. Corrupt or stale stored entries are discarded through the existing
tab parser.

The design rejects two alternatives. Reusing open-tab order would show stale insertion order and
would erase history when someone closes a tab. Showing all secondary catalog destinations would
create a scrolling sitemap and would violate the rail's role as a compact set of frequent paths.
The expanded sidebar remains the only complete catalog.

Tests will cover MRU order, deduplication, the three-item bound, persistence, title updates, and
independence from tab closure. UI tests will cover icon semantics and target geometry. The
authenticated browser check will cover the existing 80px shell region, MD3 destination states,
and responsive light and dark screenshots.
