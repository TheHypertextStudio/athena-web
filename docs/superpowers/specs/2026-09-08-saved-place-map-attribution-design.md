# Saved-place map attribution

This specification is for the Docket web maintainer who changes the saved-place map. The maintainer
must replace the current long attribution banner with a shorter visible credit without removing the
provider links.

## Decision

The map will show `© OpenMapTiles · © OpenStreetMap` in its lower edge. Each provider name will link
to its official attribution or copyright page. The credit will use one line, a small readable type
size, and a low-profile background that keeps it legible over either map style.

The picker will disable MapLibre's generated attribution control because that control repeats the
long source text from OpenFreeMap. Docket will own the short credit markup. The control will not
include OpenFreeMap because OpenFreeMap states that its own name is optional. OpenMapTiles and
OpenStreetMap remain visible because both projects require attribution.

The design rejects removing attribution because that would violate the data licenses. It also
rejects hiding the full credit behind an information button because a visible short credit has a
clearer compliance case. Shrinking the current banner would preserve unnecessary words and would
not recover enough map space.

## Behavior and tests

The credit must remain visible in light and dark themes at 1440 by 900 and 390 by 844. It must not
wrap or overlap the marker, navigation controls, or dialog edge. Keyboard users must be able to
focus both links. A component test will verify the short names and URLs and will verify that the
generated MapLibre attribution control is disabled.

The implementation depends on the current OpenFreeMap styles continuing to use OpenMapTiles data
from OpenStreetMap. A provider change would require a new attribution review.
