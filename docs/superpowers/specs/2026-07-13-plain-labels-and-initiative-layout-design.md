# Plain Labels and Initiative Layout Design

## Objective

Make Docket's labels read like ordinary interface language and repair the Initiative overview and
detail layouts at intermediate widths.

## Typography

Visible section labels use sentence case, normal tracking, and the ordinary sans-serif type scale.
All-caps overline treatments are removed across product and marketing surfaces. Genuine acronyms,
initials, and user-entered codes retain their authored capitalization.

Initiative detail uses a named `text-document-title` step that grows from 32px to 56px. The status
chip sits above the title; the summary and tabs follow it. Health remains in the property rail.

## Initiative overview

The attention module is one full-width `surface-container-low` region with modest rounding and
padding. It has no horizontal rules, outline, or shadow. Its action and pager form one trailing
control group on wide layouts and one justified footer row on narrower layouts.

The full Initiative table appears only when the content container can support all six columns.
Below that breakpoint, each Initiative uses one wide title/summary row followed by a wrapping
metadata line containing status, health, owner, target, and latest update. No metadata value is
forced into a two-word vertical stack.

## Acceptance

- No visible semantic label depends on CSS uppercase or expanded overline tracking.
- Initiative titles never exceed 56px and do not use marketing display typography.
- Attention controls share one aligned group inside a borderless tonal surface.
- Owner names, dates, and health remain readable at intermediate widths.
- Existing mobile hierarchy behavior, dark theme, print output, and accessibility remain intact.
