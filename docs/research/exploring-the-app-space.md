# Exploring the App Space

# Overview

This document outlines our understanding of the current meta for productivity apps.

In general, there are a few categories of functionality for time- and task-based productivity apps:

* Calendars  
* To-do Lists  
* Planners  
* Project management apps  
* Time tracking apps

We realize that, fundamentally, all of these apps rely on a small core set of data types that we will leverage in Athena’s implementation.

# Calendars

***Structured representations of events***

## Overview

Calendar apps are largely translations of analog physical calendars—the ones that people hang on walls and put big events on.

Calendars are generally for *event* or *milestone* planning. It makes more sense to use a calendar to keep track of events like birthdays, doctor appointments, or meetings with colleagues—things with clearly defined starts and end dates.

Calendars can also be considered a form of social data structure: they allow people to

To that end, calendars are largely treated as an entry point to a person’s time, allowing others to see when one is available (or unavailable) for a meeting, and, depending on the person, allowing others to directly modify events. Calendars can also be used for shared purposes, allowing groups of people (like teams or organizations) to see data.

Some people use calendars as sources of truth for activity planning, often not participating in any activity that hasn’t been scheduled ahead of time.

Despite their utility, modern calendars may seem too formal for some kinds of planning, like having an impromptu meeting with a friend.

## Strengths

* Calendars are a standardized source of truth for event-based planning (e.g. things that have a clearly defined scheduled date and time

* Visualizing conflicts between events is very easy with a calendar: simply look at events that overlap

## Opportunities

* Calendars can become a more general-purpose surface for visualizing time

  * ​​See [https://julian.digital/2023/07/06/multi-layered-calendars/](https://julian.digital/2023/07/06/multi-layered-calendars/)

  * See [https://maggieappleton.com/speculative-events](https://maggieappleton.com/speculative-events)

* Being able to represent multiple kinds of activities in a single view is something calendars struggle with.

* Time blocking on calendars is a pattern that only kind of works by accident; it’s likely that there are better ways of achieving this

* There may be an opportunity to turn 1D timeline views into 2D activity layers, showing overlaps between activity streams owned by different sources—people, apps, or otherwise

* Calendars could use a way to better document impromptu events

# Planners

***Structured views of work***

## Overview

Traditional “planner” or agenda-style todo-list apps really focus on the work one expects to do in a given day. 

Although they often exist as extensions of calendars, they are purely focused on a single day and often have representations that include specific *tasks* that need to be accomplished. This focus allows them to be extremely effective.

Planners like Sunama have dedicated views that allow 

## Strengths

* Planners make understanding the work that one needs to do dead simple.  
* Planners are highly customizable

## Opportunities

* Robust filtering UI

# To-Do List Apps

***Raw collections of tasks***

## Overview

To-do list apps are the bread and butter of productivity software. They make tasks actionable 

## Strengths

* Easy representation of work that needs to be done for some given domain or task  
* To-do list apps often allow users to group items into lists with particular scopes  
* To-do items can have deadlines attached  
* To-do items can have time estimates

## Opportunities

* To-do list apps are deceptively simple: on one level, their simplicity provides flexibility for any domain. On the other hand, it’s easy to fall into the trap of treating every unit of work as a to-do item.  
* It’s sometimes hard to operationalize to-do items at the correct level of abstraction or scope.  
* Time estimates for to-do items are notoriously difficult to nail down  
  * It may be possible to leverage machine intelligence to more accurately estimate how long a task will take to complete, especially if it can reliably understand the nature of its dependencies

# Project Management Apps

***Long-term planning***

## Overview

Project management apps (or apps with project management functionality)

These include apps like Jira, Linear or even GitHub. They tend to treat work as tickets or “issues”.

**Projects** are the primary unit of information here. They allow one to treat entire projects as completable entities with their own metadata like status. As such, they are useful for conceptualizing complex collections of work, like developing a multi-feature app or even planning a wedding.

## Strengths

* For accomplishing any non-trivial amount of work, especially that involving multiple contributors or stakeholders, project management apps are invaluable.  
* As higher-level representations of work, project management apps are better-suited to time estimates as they are insulated from the day-to-day minutiae of implementation details

## Opportunities

* Project management apps often have a lot of bells and whistles that could have more value for individuals outside of business contexts if properly contextualized

# Time Tracking Apps

## Overview

These apps are simple: they allow you to track how long it takes to perform tasks. These kinds of apps are often useful for freelancers

## Strengths

* These apps provide a highly granular ability to track *how long* it takes to complete 

## Opportunities

* It’s unclear what the best way of connecting time tracking apps and calendar is  
* There’s no clear meta for how to represent activities that occur simultaneously  
* There’s no clear meta for how to align time tracking entries with higher-level strategic objectives   
* Time tracking apps would be much more useful when integrated intuitively with other productivity software instead of duplicating their functionality  
* More work is needed to understand the best user experience for handling work that repeats (e.g. daily standup meetings, mowing the lawn)  
* Being able to monitor and reflect on how one spends their own time in a personal context can be very useful for measuring some kinds of personal goals

# Habit Tracking Apps

## Overview

Habit tracking apps measure the frequency of occurrence for a particular series of activity, whether how often one practices piano, reads, or talks to friends.

## Strengths

* Habit tracking is very simple to use and provides a solid amount of data: just simply press a button when a habit is fulfilled, and you can record when that habit occurs  
* It’s easy to aggregate habits to show larger trends visually and provide meaningful and motivational feedback for a user

## Opportunities

* It should be easy to align habits with higher-level personal strategic objectives; there are no mainstream (or possibly any) apps on the market that allow one to   
* There is some overlap between habits that are tracked and the implicit activities that are performed when completing a task; more work is needed to create a familiar user experience here.

# Interaction Patterns

We try to make maximum use of interface patterns to make software more accessible and flexible for our users:

* Point and click  
* Drag and drop  
* Arrow keys for navigation  
* Focus-dependent keyboard shortcuts  
* Global keyboard shortcuts
