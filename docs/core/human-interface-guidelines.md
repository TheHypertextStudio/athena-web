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

While the information represented by a card may be an object, the interface itself is a surface. A surface is a *medium* for interaction.

Surfaces translate intent into action, converting actions that a user takes (like clicking on an item) into updates to a surface or data.

## Objects

Objects are structured units of semantic information. This includes information like tasks, events, or user profile data. In other words, objects are *entities*.

Objects are semantic in that each of their parts has meaning. For example, a task may have a date associated with it that has the semantic meaning of a due date.

Objects can be composed of other objects, organized into collections with metadata, the composition of which itself is treated as an object.

Because objects are self-contained units of information, they can be transferred between surfaces. Objects also have identity. Whenever multiple instances of the same object are displayed at the same time, they should have consistent state except when one instance is being edited. Surfaces should always be careful to distinguish between instances of an object and copies of an object’s data.

## Flows

A flow is a collection of surfaces organized for a particular purpose. In other words, a flow is a *process*.

Flows capture state and context, translating actions into operations with intent. All user activities happen within the context of a flow.

Examples of flows including a customer onboarding, a document editor, and an event editing experience.

## Terminals

A terminal is the place where interfaces are rendered or actualized to the user. For graphical interfaces, this may take the form of windows in a traditional desktop setting, a mobile phone screen, or similar discrete forms of visual output.

Multiple terminals can be leveraged at the same time to provide complementary information or to distinguish their scopes. A single terminal should only render a single flow at a time to avoid creating unnecessary cognitive load on the user.
