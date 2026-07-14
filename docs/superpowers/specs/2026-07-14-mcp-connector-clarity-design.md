# MCP Connector Clarity Design

## Goal

Make the Athena connector surface readable at a glance and keep the standard OAuth path to one URL field and one action.

## Design

- Rename the section to **Tools for Athena** and remove protocol explanation from the default view.
- Present connected tools as vertical records: name and state, available tool count, optional details, then actions.
- Derive the provider name and tool prefix from the server URL. Operators can reveal **Edit details** to override either value.
- Keep OAuth as the default. Bearer credentials and unauthenticated servers live under **Other connection methods**.
- Keep status copy to a short state label.

## Validation

Test URL-derived connector defaults, typecheck and lint the web app, and capture the rendered connection flow through Playwright.
