# Initiative Mobile Spacing Design

## Objective

Give the top of the mobile Initiative overview a calmer grouped rhythm without shrinking, hiding,
or rearranging its information.

## App shell reminder

The recovery reminder keeps its existing tonal surface and normal body copy. Its layout has three
columns: the recovery icon, a message-and-action block, and the dismiss control. The action sits
below the message and its label shares the message's left edge. The icon, first line of copy, and
dismiss control align optically across the top. Both controls retain at least a 40-pixel interactive
area, and the layout must not force word-by-word wrapping at narrow widths.

## Initiative page rhythm

The page uses grouped vertical spacing rather than one uniform compressed stack. The global
recovery reminder remains part of the app shell. Inside the Initiative page, the title and primary
action remain one header group; the attention surface follows with 24 pixels of separation. The
roster controls follow the attention surface with 32 pixels of separation so the attention surface
does not visually merge into the working list.

Desktop density and the existing Initiative hierarchy, attention behavior, responsive roster,
themes, and accessibility contracts remain unchanged.

## Acceptance

- Recovery copy uses the standard body size and retains the existing tonal banner surface.
- The action is below the copy and its label aligns with the copy's left edge.
- The dismiss control is not adjacent to the action.
- The banner remains readable without aggressive word wrapping at mobile widths.
- The Initiative header, attention surface, and roster controls read as three grouped regions.
- Existing 40-pixel interactive-target and Material icon requirements remain intact.
