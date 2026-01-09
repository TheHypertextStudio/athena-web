# Core User Journeys

## Flows to test

# Sign-Up

_Account creation_

## Main Path

- From the app landing page (or any other source), I navigate to the sign-up page
- I see a reassuring, mobile-responsive UI that includes the name and logo of the app, an indication that this is a sign up page, options to create an account using email link or our supported identity providers, the product terms of service, and its privacy policy.
- If use the email link option, The UI updates to hide other options and show me a labeled field to provide my email
- If I attempt to create an Athena account using any provider for which the service detects there is already an associated account, I will be shown a screen informing me that I already have an account connected to that identity provider, providing an option to sign up with another account, redirecting back to the start of the sign-up flow in addition to a subtle label saying something like “Confused? Contact support” with a link to the support page
- After being successfully redirected from a third-party identity provider, I am redirected to the app’s onboarding.

# Sign-In

_Authentication with an existing account_

## Main Path

- From the app landing page (or any other source), I navigate to the sign-in page
- I see a reassuring, mobile-responsive UI that includes the name and logo of the app, an indication that this is a sign in page, options to sign in via a passkey or one of our supported identity providers, the product terms of service, and its privacy policy.
- When I click any of the third-party identity providers, I am redirected to their respective sign-in flows
- If I attempt to sign in with any provider for which the service detects I do not have an associated account, I will be prompted whether I wish to create a new account, which would continue to the onboarding flow, or exit, which would redirect me back to the app landing page
- After being successfully redirected from a third-party identity provider, I am redirected to the app’s onboarding if I have not completed it; if I have completed onboarding, I am redirected to the app’s home page.

# Onboarding

- If I used a third-party identity provider to create an account, information from that account’s metadata will be used to pre-populate form fields including name, birthday, and email address
- I am greeted by Athena, the app’s assistant.
- Athena asks me for my name (“What would you like me to call you?”) and for what reason I want to use the app
- On follow-up screen, Athena responds, summarizing/rewording my intentions and asks some more questions, giving me the ability to clarify the kind of work I do using multiple-selection prompts while additionally giving me the ability to clarify using natural language
- Based on my intentions, Athena asks if I'd like to connect one or more data providers in a completable list interface that updates after I sign into them (e.g. Linear, GitHub, Google Calendar) and authorize their data sharing with the necessary scopes
- Athena uses the information provided to it to fetch and generate an initial agenda for me in real time, pulling in tasks and events from connected integrations
- Athena asks if the generated agenda looks good and offers to make adjustments based on my feedback
- I can review and approve the initial agenda, or request changes before proceeding
- Once I approve the agenda, I am taken to the main app home screen with my personalized agenda displayed
- I can return to onboarding settings later to connect additional integrations or modify my preferences

# Agenda (Home)

## Main Path

- I open my agenda and see a sequential list of all scheduled work I have to complete for the day
- I can see tasks organized by priority with time estimates displayed alongside each item
- I drag a task to reorder it, and the agenda updates to reflect the new order
- I can click on a task to view its details, mark it complete, or start a timer
- I can see calendar events interspersed with tasks to understand my full day at a glance
- I can filter the agenda by initiative, project, or source integration

## Alt Path: No Remaining Tasks

- If there are no scheduled items on my agenda, I see a delightful empty state informing me of that fact
- The empty state subtly congratulates me that I don't have any work left for the day
- I am offered options to browse my backlog, plan tomorrow, or explore one of my initiatives

# Activity Management

## Main Path

- I can select an activity from my activity stream, opening a detail modal
- The modal shows the activity type, duration, associated metadata, and any linked tasks
- I can edit the activity's details including start time, end time, and notes
- I can link the activity to a task or project if it wasn't automatically associated
- I can delete an activity if it was logged in error

## Creating Manual Activities

- I can click a button to log a new activity manually
- I select the activity type from a dropdown or create a new type
- I set the start and end times using a date/time picker
- I can optionally add notes and metadata to the activity
- The activity appears in my activity stream immediately after saving

# Inbox

_Triage for tasks_

## Main Path

- I open the inbox using an item in the top navigation bar
- I see a list of items requiring my attention: new tasks from integrations, suggested tasks from Athena, and notifications
- I can quickly process each item by accepting, rejecting, or snoozing it
- Accepted tasks are added to my agenda or backlog depending on their priority
- I can bulk-select items to process multiple at once
- Once all items are processed, I see a completion message with a count of actions taken

# Subscriptions

_Managing billing and plan selection_

## Main Path

- I navigate to the subscriptions page from app settings
- I see my current plan, its features, and the renewal date
- I can compare my plan to other available tiers in a feature comparison table
- To upgrade, I click on the desired plan and am taken to a Stripe checkout flow
- After successful payment, my account is immediately upgraded and I see a confirmation

## Downgrading or Canceling

- I can click to downgrade my plan, which shows me what features I will lose
- I am asked to confirm the downgrade and given the option to provide feedback
- If I choose to cancel entirely, I am shown what data will be retained and for how long
- I can export my data before cancellation using the account data management tools

# Product Support

_Getting help with the app_

## Main Path

- I am able to visit a publicly-accessible page on the app's website for documentation and FAQs
- I can search the knowledge base using a search bar
- I can access contextual help from within the app using a help icon
- For account-specific issues, I can submit a support ticket through the app
- I receive email updates about my support ticket status
- I can view my ticket history and any responses from the support team

# Focus Mode

_Distraction-free work session_

## Main Path

- I select a task and click "Enter Focus Mode" to begin a focused work session
- The UI transitions to a minimal view showing only the current task, a timer, and essential controls
- I can start, pause, or stop the timer associated with the task
- I can take quick notes without leaving focus mode
- I can exit focus mode using a close button, returning to my previous context
- Time tracked in focus mode is automatically logged to the task

# Settings

_Configuring the app_

## Main Path

- I navigate to settings from the user menu or sidebar
- I see categories for account, preferences, integrations, notifications, and data
- I can update my profile information including display name and avatar
- I can configure notification preferences by channel and event type
- I can manage connected integrations and trigger manual syncs
- I can configure Athena preferences including LLM provider and interaction style
- I can define custom statuses for tasks, projects, and initiatives
