# User Stories

# Authentication

* As a user, I can sign into the app using my Google Account  
* As a user, I can sign into the app using my Apple Account  
* As a user, I can sign into the app using my Microsoft account  
* As a user, I can add passkeys to my account so that I do not have to use any other provider to sign into the app  
* As a user, I can sign into my account using a platform-native passkey  
* As a user, I can sign into my account using cross-device sign in  
* As a user, I can sign into my account using passkey conditional UI so that I have a hint that I can use a passkey  
* As a user, I can associate my account with an organization managed SSO so that the lifetime of my account outlasts my organization’s identity provider  
* As a user, I can recover my account using some kind of backup code if I ever lose access to my passkeys or other methods of sign-in  
* As a user, I can see the last used method of sign-in on any auth screen  
* As a user, I receive guidance on how to proceed if I try to sign into my account using   
* As a user, I am offered the option to link an identity provider to an existing account if I try signing into an account using an identity provider that is not already associated with an account

# Account Data Management

* As a user, I can enable and disable encryption at rest of my data from within the app settings  
* As a user, I can export all my account data in a structured, machine-readable format with schema definitions and clear documentation for how to import that data into other tools or otherwise make that data useful for scripting, visualization, or other purposes  
* As a user, I can delete my account from app-wide settings so that I can disassociate all data form the service

# Account Linking

* As a user, I can link my Linear account to my Athena account by signing into it so I can see projects and tasks from it surfaced in the app  
* As a user, I can link my Microsoft account to my Athena account by signing into it so I can see projects and tasks from it surfaced in the app  
* As a user, I can link my GitHub account to my Athena account by signing into it so I can see projects and tasks from it surfaced in the app

# Onboarding

* As a user, I go through a turnkey onboarding process after creating an account so that I understand the core functionality of the app  
* As a user, I am introduced to the Athena assistant and have an opportunity to interact with it so I have an idea of its capabilities  
* As a user, I am given the opportunity to connect third-party accounts in an elegant but non-intrusive way by being inferred so that the app has more functionality  
* As a user, my onboarding progress is saved so that I am encouraged to complete it before being allowed to use the app  
* As a user, I can skip most of onboarding if I please

# Time Tracking

* As a user, I can track how much time it takes me to complete a task by manually starting a timer  
* As a user, I can modify   
* As a user, I can designate multiple blocks of time that I work on task  
* As a user,

# Focus/Companion Mode

* As a user, I can enter a focus so that I have an active indicator as my work that is suitable for a second monitor.  
* As a user, I am able to write notes or otherwise perform simple actions like starting/stopping time tracking  
* As a user, I can exit the focus mode using a close button that returns me to the prior context

# Command Palette

* As a user, I can perform any basically action in the app using a command palette  
* As a user, I receive autocomplete hints for matching commands  
* As a user, I receive autocomplete hints for actions that are context-dependent and adapt to data that is relevant to the   
* As a user, I can use form fields provided by and embedded in the command palette modal itself to provide information.  
* As a user, I can use fuzzy matching to search for actions

# Calendar

* As a user, I can create events on my calendar so that I have a first-party way of creating events  
* As a user, I can select some period of time on my calendar using a dragging motion to begin the event creation process  
* As a user, I can change the time zone used for any calendar view  
* As a user, I can visually zoom into or out of a calendar by adjusting the scale of events along a particular time axis  
* As a user, I can use intuitive transitions to switch between an agenda, daily, weekly, monthly view  
* As a user, I can also define a custom period of time to create a calendar view  
* As a user, I can filter events on a calendar view by their source  
* As a user, I can see time blocks on my calendar and their associated tasks  
* As a user, I can see calendar events with defined start and end times that span multiple days as continuous blocks that appear on the calendar when multiple days are present  
* As a user, I can designate instances of time blocks on my calendar that I can label for particular purposes  
* As a user, I can create bounded or unbounded automatically repeated occurrences of time blocks on my calendar so that I can create consistent schedules for work

# Calendar Sync

* As a user, I can link my Google Calendar to the service so that its calendar events can appear in Athena’s calendar  
* As a user, I can link my Outlook Calendar to the service so that its calendar events can appear in Athena’s calendar  
* As a user, I can link my iCloud Calendar to the service so that its calendar events can appear in Athena’s calendar  
* As a user, I can import any calendar to the service so that its calendar events can appear in Athena’s calendar  
* As a user, when I link a calendar from a supported third-party application, I am able to make changes to events in those calendars

# Adding a Task

* As a user, I can create a task for myself with a title and an optional description  
* As a user, I can set a deadline for a given task  
* As a user, I can create tasks with dependencies that so I can establish order between them  
* As a user, I receive actionable guidance on creating tasks with dependencies so that I can better optimize my time  
* As a user, I can designate a time estimation for a task  
* As a user, I can easily use a time estimation that was recommended by the Athena assistant for a task

# Daily Planning

* As a user, I can view an agenda of the current day’s events and tasks  
* As a user, I can view the status of task completion  
* As a user, I can visualize how much time I am spending on each of my current initiatives  
* As a user, I can see how much of my day is utilized so that I can budget time for non-work-related activities  
* As a user, I can rely on Athena to sort the order of my tasks to prioritize initiatives  
* As a user, I can rely on Athena to balance the time I spend on tasks to ensure I do not focus too much on a single initiative or project  
* As a user, I can visualize work and non-work tasks on the same daily schedule so that I have a holistic understanding of how my time is spent.  
* As a user, I can plan the work or activities for a day in advance

# Starting a Project

* As a user, I can create a project to group together related work  
* As a user, I can assign one or more tasks to a project  
* As a user, I can associate existing tasks to a project

# Managing Projects

* As a user, I can define a dependency from one to another or vice versa so that I can establish the order of work for projects  
* As a user, I can set the status of a project to one of the statuses I have defined in app settings

# Starting Initiatives

* As a user, I can create strategic initiatives to organize projects into higher-level themes so that I can mentally organize work at a high-level  
* As a user, I am able to use Ada to help me create initiatives   
* As a user, I can view a live draft of an initiative during initiative creation sessions  
* As a user, I am able to create initiatives completely on my own without any assistance from Ada if I want.  
* As a user, I can set the status of an initiative to one of the statuses I have defined in app settings

# Workspaces

* As a user, I can create workspaces to scope or filter work  
* As a user, I am not restricted to only viewing information within the context of a workspace so that I always have a holistic view of work  
* As a user, I can set the name of a workspace  
* As a user, I can designate a description for a workspace  
* As a user, I can allow others to

# Index

* As a user, I have a way to browse all of the data that is linked to all objects viewable to me so that I can see documents and other multimedia referenced my tasks or projects in one place  
* As a user, I access this information from any project or initiative  
* As a user, I have a way to search through my Index  
* As a user, I can quantify how much data is associated with my account

# User Preferences

* As a user, I can set my preferred name for the Athena assistant to address me  
* As a user, I can set the time at which I am notified to plan or review my plan for the day

# Time Blocking

* As a user, I can designate some period of time for some arbitrary purpose without it being blocked off on my calendar to others  
* As a user, I can assign tasks to a time block

# Time Tracking

* As a user, I can see a visual breakdown of how I spent every tracked minute  
* As a user, I can use a table to see a log of all of my time tracking instances  
* As a user, I can filter entries in a table by using interactive filters
