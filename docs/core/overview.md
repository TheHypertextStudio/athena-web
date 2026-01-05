# \<project-athena\>

## The best friggin’ productivity app there is or ever was.

# TL;DR

We’re going to build Project Athena, a digital chief of staff built on top of a future-facing personal activity management platform.

# Motivation

Project Athena is an attempt to build the “ultimate” productivity app”.

But what differentiates Project Athena from other productivity apps?

I do not want to use three different apps just to keep track of the work I have done and the work I need to do. I want a system that can keep track of all of my activities so I can focus on execution and higher-level planning rather than trying to optimize minutes out of my day.

Back in college, I was involved in three different organizations at any given moment, each of which had their own calendar and set of tasks and objectives to track. This was, of course, on top of the academic work from each of the five to six classes I was taking each semester. I was able to use [Sunsama](https://www.sunsama.com/) to orchestrate such a complex deluge of work, but I realized it was challenging trying to outline bigger-picture objectives while aligning them with the day-to-day of what I was working on. And there was, of course, a real concern that the time I spent planning my work detracted from the work itself that needed to be done.

Fast forward to late 2025 where I’m working on a tech startup and attempting to start some new media projects. Each of these initiatives have vastly different scopes and are composed of several different independent projects that align with several personal objectives (e.g. become more social; be more become more civically engaged; grow my technical knowledge) along with initiative-specific strategic goals (e.g. develop an audience that can financially support my civic engagement projects; launch a product that provides value to a thousand people). For me, these initiatives aren’t just stretch goals for the year. They are strict objectives for which I do not want to make any excuses.

I’ve taken a look back at my calendar only to surprise myself at the sheer density of work relative to the amount of work I feel I accomplish each day in the present. I was able to do a lot of work because I kind of forced myself to. Daily tasks weren’t just suggestions. They were obligations, and the systems I had in place (technical, social, or otherwise) supported them.

Of course, I’ve learned a lot since my undergraduate years. After a stint of burnout, I recognize the value in doing work sustainably, but I also recognize that doing really interesting work demands a high amount of focus. Not merely the appearance or feeling of being productive, but genuine effort spent doing a lot of work toward very particular ends.

Therefore, I want to strike a balance.

Tools like Google Calendar are excellent at visualizing how much time I spend on tasks, but they are too isolated from other data sources or otherwise have suboptimal UX.

Tools like Linear are excellent at relating assignable tasks (issues) to larger collections like team-bound projects or organization-wide initiatives, but they are, of course, really meant for planning within larger organizations. I want to take the capabilities of these tools and make them more useful in a personal context.

I needed a system that could holistically capture all activities in my life, doing the cheesy work of “breaking down information silos” that companies could really only dream of.

And even more than that, I wanted something that *just worked.*

As agentic AI (for lack of a better term) has become more capable at making information actionable, I understood that there was an opportunity to build some productivity software that didn’t just feel like a generic SaaS. I figured I could do better. With some amount of knowledge about software engineering, product design and machine intelligence, I knew it was possible to take the benefits of LLMs that had strong semantic understanding, couple them with human-focused software design, and build an opinionated piece of software that would be the last “productivity app” I’d ever need.[^1]

So that leads us here: yet another productivity app, but one that feels much more modern and well-suited for the next generation of intent-driven software.

We’re creating a unified activity layer for tracking work and making tasks more actionable.

# Goals

* Develop a production-ready, user-friendly piece of multi-platform consumer software entirely using AI coding tools  
* Build an elegant but powerful piece of software  
* Rigorously document the various quirks faced by developers whilst using autonomous coding agents  
* Determine to what extent it is possible to completely automate software engineering and development end-to-end in January 2026

# Core Features

## An Agenda that Just Works

Athena provides a single agenda that allows a user to quickly see all work they need to complete for a given day or other period of time. This work can be visualized as a single discrete list of tasks or a stream of all known scheduled future tasks to be completed.

Furthermore, this agenda allows the user to divide or group work into useful arbitrary distinctions, like “must-complete” and “stretch” tasks or otherwise.

This agenda allows users to easily change the anticipated order of tasks and additionally assign them to time blocks in their app-wide calendar.

## Centralized Calendar Management

Digital natives often have multiple calendars spread across multiple accounts. We’re building a solution that brings all of those calendars into a single surface with bi-directional syncing. It will be easy for a user to show all events across calendars or filter events based on calendar while using Athena as their primary calendar.

## Centralized Task Management

Similar to our centralized calendar management, I want to centralize task tracking across all kinds of mainstream to-do list apps like Google Tasks. Athena will support its own first-party tasks but allow tasks from external providers to be synchronized.

## Multi-layer Activity Tracking

Inspired by Julian Lehr’s [“multi-layered calendars”](https://julian.digital/2023/07/06/multi-layered-calendars/) idea, we’re going to create systems that allow users to document the activities using independent, complementary user-defined data layers. These data layers may include anything from listening data from Spotify to health data from fitness trackers. Users will be able to build their own integrations.

A user will be able to use Athena to answer questions like “How much time did I spend on flights last year?” and “How frequently did I spend time with friends?”

Athena on mobile devices will allow users to securely track and contextualize location history, allowing them to see timelines of activities similar to Google Maps.

## Semantics-Aware Data Attachments

Our app will support being able to associate basically any external data with our app’s primitives. 

This includes functionality like using emails as attachments for tasks or calendar events. If it has a MIME type, it can be represented in the app or even linked in a way that feels natural to whatever context in which it appears.

## Athena, the Actionable Assistant

AI assistants in task-planning apps often lack utility.

Put simply, they’re kind of dumb.

Tools like Motion ostensibly integrate AI into their app, but they do it in ways that are either naive or don’t leverage the increasing power of agentic systems. Google Calendar only provides minimal AI integration with Gemini, and it’s only one way: events from Calendar can be surfaced in Gemini, but they are read-only and have no affordances for making that information actionable.

We’re going to build an assistant that is more than just a chatbot. Athena will not just be able to do what competitors do—managing calendars and tasks—but will be able to handle work delegated to it so you can focus more on strategy than rote execution.

## Automatic Event and Time Block Scheduling

Athena will be able to use information in your emails and other data streams to automatically schedule events automatically or with your approval depending on your preferences. It will raise attention to work that needs to be done, including action items from documents or emails, whether they’re as simple as making sure to pay a bill or submit a proposal for a grant.

If there is a task that needs to be done, Athena will propose time blocks to complete that task. And if it’s unclear how a task will get done, Athena will propose tasks to complete *before* another one. It will even attempt to determine collections of work that should be completed within particular time blocks.

## Initiative Planning

Athena will help organize your desired objectives into larger themes that help you measure your progress and achieve what you want.

Using natural language, Athena will analyze your goals and attempt to reason higher-level objectives that can be broken down into concrete projects. It can also help you reorganize existing projects and work into initiatives that better reflect your goals.

Whether you are the CEO of a medium-sized startup or the president of the PTA for your child’s elementary school, Athena will help you with bigger-picture thinking in ways that feel natural but powerful.

# Conclusion

Yeah, we’re building a productivity app, but this shouldn’t feel like just a “productivity app”. Fundamentally, it’s a tool for reasoning beyond simple project management and daily planning. The Athena assistant is a digital chief of staff that can be used as an executive assistant but also so much more. It is able to leverage the vast context of information provided to it, and our platform’s interface makes using this thing a genuine delight rather than a chore.

[^1]: Yes, I recognize this may remind you of the [xkcd: Standards](https://xkcd.com/927/) comic. Fortunately, I’m not trying to build a better standard. I’m just trying to build something I (and hopefully a few others) like.
