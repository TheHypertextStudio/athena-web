# Compact navigation rail density

This design directs the Docket Web maintainer who changes the collapsed navigation rail. The
maintainer must reduce the vertical space used by primary destinations without removing labels or
weakening the existing interaction states.

## Decision

The collapsed rail will use a 56px target for each primary destination and a 4px gap between
adjacent destinations. Six destinations will consume 356px instead of 404px.

Each destination will keep its visible label, 24px icon, and 56×32 indicator pill. The rail will
keep its 64px width and the shell will keep its 80px total reserved region. The scrolling
destination region will extend to 66px through 1px outer margins so the complete offset focus
outline remains visible. Workspace, expand, account, and recent-document controls will keep their
current 40px targets.

## Interaction states

The density change will not alter the indicator state model. Selection will remain on the
secondary-container indicator and secondary label. Hover, press, keyboard focus, and combined
hover plus focus will keep their current opacity layers. Keyboard focus will keep the 3px
secondary outline with the Material 2px outward offset around the indicator pill. Selection alone
will remain borderless.

The full 64×56 destination will remain selectable. The visual state will remain confined to the
56×32 pill.

## Alternatives rejected

A zero-gap stack would reduce the six-item block to 336px, but adjacent destinations would read as
one compressed group instead of separate controls. A 2px gap would preserve more density, but it
would break Docket's 4px spacing grid. An 8px gap would restore too much of the loose rhythm that
this change removes. An icon-only rail would be denser, but it would remove the persistent labels
that the user chose to keep.

## Verification

The component test will enforce a 56px destination and 4px gap. The authenticated browser test
will measure the 64×56 target, the 56×32 indicator, 66px destination scrollport, 4px gap, the
unchanged 80px shell region, and the existing computed interaction states. Light and dark
screenshots at desktop widths will show the tighter primary block and its relationship to
recent-document shortcuts.

The implementation will not change navigation data, recent-document tracking, route behavior, or
the expanded drawer.

## Recent entity identity

The three recent-document shortcuts use each entity's detail-page identity at 32 px. Projects and
Initiatives show their saved icon, preset or custom color, and tonal circle through the shared
`EntityIconGlyph`. Programs and Cycles reuse their fixed detail icon. Tasks and Sessions use their
fixed tab-type icon. The rail puts each fixed icon in the same 32 px tonal circle. The shell must
not replace a saved entity icon with a generic type glyph.

The Web application owns display-data reads. The shared shell accepts a renderer for the identity
slot because importing Web queries or the Web icon catalog into `@docket/ui` would invert the
package boundary.
