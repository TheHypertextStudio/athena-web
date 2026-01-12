# Human Interface Guidelines

# Approach

In general, we’re going to take a Linear-like approach to building our software: with craft and simplicity at the forefront, avoiding bloating our software with a deluge of features and instead focusing on a narrower set of user experiences that make sense for the context for a given journey.

Each product surface is really just an opinionated way for organizing the underlying data types that makes sense for the norms of that platform.

# Principles

## Prioritize intent over feature

Athena should be built in a way that is more human-centric than product centric. Any features that are included are done to to solve particular problems, not solely to check off functionality checkboxes against competitors.

Functionality across our product must be organized in a way that adapts to the user’s needs, not requiring them to adapt to the limitations of internal implementation detail for a feature. We should refrain from unfortunately surprising the user, always keeping in mind the user’s mental model of the intent of their task.

## Prefer native conventions

Project Athena should adapt to the native UI/UX paradigms of the underlying platform while still remaining consistent in functionality across product surfaces.

In general, we delegate functionality and conventions to the underlying platform/operating system for which a client is built instead of attempting to reinvent functionality that already exists. For mobile devices, we prioritize touch; for desktop devices

This does not preclude us from, let’s say, implementing a date picker for a particular context if there is significantly more value in our own implementation, but we should always be deliberate about attempting to replicate functionality provided by a platform.

## Leverage existing primitives

We should prefer creating interfaces that are modular and composable. Instead of creating complex interfaces to solve extremely particular tasks, we should generally try to prefer building reusable components that still have similar functionality and meaning in the contexts they are used. We prefer thinking bottom-up from the user’s perspective rather than attempting to implement features based on arbitrary top-down structural organization, such as designing functionality based on the screen it will appear in rather than a particular part of a process.

## Give users agency

While we try to anticipate what the user wants, we ultimately do not want to get in their way. Assistive functionality should only seek to help the user, never annoy them.

While we try to minimize cognitive load, we do not try to belittle the user’s intelligence. Whenever the product tries to act on the user’s behalf, we always provide escape hatches or options to allow the user to accomplish a task themselves.

## Connect information when possible

We should try to make information as actionable as possible. In line with the principles of hypertext, we should always try to provide links between information and expose explicit actions that are context-dependent. Users should be able to navigate to the source of truth for any information in the app. Information in our software should not be isolated; we should generally try to use our interfaces to intelligently provide context as needed to reduce user surprise, give users more agency when completing a task, and build software that is pleasant and trustworthy to use.

## Explicit is better than implicit

Athena is designed in such a way that balances simplicity and actionability. We do not design interfaces that look clean at the expense of accessibility and discoverability of functionality. We do not refrain from labeling information to satisfy the whims of some junior developer.

# Interface Primitives

## Overview

Our product is oriented towards a few underlying data structures, each of which can be expressed as a discrete object. These objects are then composed into surfaces that are rendered to complete particular user goals. Generally, we approach designing interfaces and experiences in terms of these primitives, translating them into implementation detail depending on the platform on which they appear.

## Surfaces

Surfaces are places where information can appear and be made actionable. For graphical interfaces, this may take the form of a card, a pop-up, a modal dialog, or similar containers.

While the information represented by a card may be an object, the interface itself is a surface. A surface is a _medium_ for interaction.

Surfaces translate intent into action, converting actions that a user takes (like clicking on an item) into updates to a surface or data.

## Objects

Objects are structured units of semantic information. This includes information like tasks, events, or user profile data. In other words, objects are _entities_.

Objects are semantic in that each of their parts has meaning. For example, a task may have a date associated with it that has the semantic meaning of a due date.

Objects can be composed of other objects, organized into collections with metadata, the composition of which itself is treated as an object.

Because objects are self-contained units of information, they can be transferred between surfaces. Objects also have identity. Whenever multiple instances of the same object are displayed at the same time, they should have consistent state except when one instance is being edited. Surfaces should always be careful to distinguish between instances of an object and copies of an object’s data.

## Flows

A flow is a collection of surfaces organized for a particular purpose. In other words, a flow is a _process_.

Flows capture state and context, translating actions into operations with intent. All user activities happen within the context of a flow.

Examples of flows including a customer onboarding, a document editor, and an event editing experience.

## Terminals

A terminal is the place where interfaces are rendered or actualized to the user. For graphical interfaces, this may take the form of windows in a traditional desktop setting, a mobile phone screen, or similar discrete forms of visual output.

Multiple terminals can be leveraged at the same time to provide complementary information or to distinguish their scopes. A single terminal should only render a single flow at a time to avoid creating unnecessary cognitive load on the user.

# Visual Behavior

Our interfaces must feel alive, connected, and responsive. Nothing should feel static or disconnected. Every visual change should communicate meaning and maintain spatial continuity.

## Core Tenets

### Nothing appears from nowhere

Elements must never pop into existence. Every new element should enter the view through a deliberate transition that communicates its origin:

- Elements expanding from a trigger point should animate from that point
- List items should stagger their entrance, not appear simultaneously
- Modal dialogs should scale or fade from their invoking element
- Buttons and interactive elements should fade in with a subtle opacity transition

### Nothing shifts without purpose

Layout changes must be animated. Users should never experience sudden jumps or reflows:

- When content loads, reserve space or animate the insertion
- When elements resize, animate the bounds change
- When items reorder, animate their positions
- When sections expand or collapse, the transition should be smooth and trackable

### Everything is connected

Visual continuity must reinforce conceptual relationships:

- When navigating from a list item to a detail view, the transition should establish the connection between them
- Shared elements (like titles, icons, or thumbnails) should animate between their positions across views
- Color, shape, and motion should reinforce that two views represent the same underlying object
- Parent-child relationships should be visually evident through spatial animation

## Transitions

### Shared Element Transitions

Shared element transitions are a first-class concern, not an afterthought. When an element represents the same object across two views, it must visually travel between those positions.

**Required for:**

- Task cards opening into task detail views
- Calendar events expanding into event editors
- List items becoming full-screen views
- Thumbnails becoming full images

**Implementation guidance:**

- Identify the persistent element (the thing that represents continuity)
- Animate position, size, and shape from origin to destination
- Cross-fade any content that changes between views
- Duration should be 200-300ms for most transitions
- Use ease-out curves for entrances, ease-in for exits

### View Transitions

When changing between views within the same flow:

- Use directional slides that match the conceptual hierarchy (forward = slide left, back = slide right)
- Cross-fade background content while sliding foreground content
- Maintain context by keeping stable elements (like headers) in place

### State Transitions

When an element changes state:

- Interactive states (hover, pressed, focused) should transition over 100-150ms
- Selection states should animate with a subtle scale or highlight effect
- Loading states should use skeleton screens that match the final layout, not spinners that provide no spatial information
- Error states should draw attention through color transition, not sudden appearance

## Progressive Disclosure

Information density must be managed through progressive disclosure. The interface should reveal complexity gradually, responding to user intent.

### Hover and Focus States

On terminals that support pointing devices:

- Hovering over an element should reveal secondary actions and metadata
- Hover cards should fade in after a brief delay (150-200ms) to avoid flickering
- Revealed content should not cause layout shifts—use overlays or reserved space
- Focus states should be visually distinct and animate smoothly

### Expansion Patterns

- Summary views should expand to reveal detail, not navigate away
- Expansion should animate bounds to show the relationship between summary and detail
- Collapsed state should hint at available content (truncated text, overflow indicators)
- Users should be able to expand without losing their place in a list or view

### Contextual Actions

- Actions should appear contextually near the element they affect
- Action menus should emerge from their trigger point
- Destructive actions should require deliberate interaction (not just hover)

## Layout Principles

### Stability

Layouts must remain stable during interaction:

- Reserve space for content that will load asynchronously
- Never allow content to reflow while the user is reading or interacting
- If content height is unknown, use a reasonable estimate and animate to actual height
- Infinite scroll should not cause existing content to jump

### Responsive Behavior

When viewport or container size changes:

- Elements should animate to their new positions and sizes
- Content reflow should be smooth, not instantaneous
- Breakpoint changes should feel like a transformation, not a replacement

### Spatial Consistency

- Elements should maintain consistent positions across related views
- Navigation elements should be anchored to predictable locations
- The user's eye should be able to track important elements across transitions

## Platform Idioms

Leverage native capabilities rather than reinventing them:

### Pointer-Based Terminals (Desktop)

- Support hover states for progressive disclosure
- Use native tooltips for simple labels
- Implement context menus for secondary actions
- Support keyboard navigation and shortcuts
- Respect system preferences for reduced motion

### Touch-Based Terminals (Mobile)

- Use press-and-hold for contextual actions
- Implement swipe gestures for common operations
- Support pull-to-refresh where appropriate
- Respect safe areas and system gestures
- Use haptic feedback to confirm actions

### Accessibility

- All transitions must respect `prefers-reduced-motion`
- When motion is reduced, use opacity fades instead of positional animations
- Ensure transitions don't interfere with screen readers
- Maintain focus management through view transitions

## Timing Guidelines

| Transition Type                   | Duration  | Easing        |
| --------------------------------- | --------- | ------------- |
| Micro-interactions (hover, press) | 100-150ms | ease-out      |
| Element state changes             | 150-200ms | ease-out      |
| Shared element transitions        | 200-300ms | ease-out      |
| View transitions                  | 250-350ms | ease-in-out   |
| Complex choreographed sequences   | 300-500ms | custom curves |

**General rules:**

- Faster is usually better—transitions should enhance, not delay
- Exits can be faster than entrances
- Staggered animations should have 30-50ms delays between elements
- Never exceed 500ms for any single transition
