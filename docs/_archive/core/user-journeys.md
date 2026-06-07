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
- Based on my intentions, Athena asks if I’d like to connect one or more in a completable list interface that updates after I sign into the data providers (e.g. Linear, GitHub, Google Calendar) and authorize their data sharing with the necessary scopes
- Athena uses the information provided to it to fetch and generate an agenda for the user in real time
- Athena asks if the user
- The user

# Agenda (Home)

## Main Path

- I open my agenda and see a sequential list of all scheduled work I have to complete that I have
- I drag a task at the bottom of the list to reorder it

## Alt Path: No Remaining Tasks

- If there are no scheduled items on my agenda, I see a delightful empty state informing me of that fact, subtly congratulating me that I don’t have any work left for the day, possibly giving me an option to complete some other task related to one of my objectives

# Activity Management

## Main Path

- I can select an activity, opening up a modal

# Inbox

_Triage for tasks_

- I open the inbox using an item in the top navigation bar

# Subscriptions

##

# Product Support

- I am able to visit a publicly-accessible page on the app’s website

#
