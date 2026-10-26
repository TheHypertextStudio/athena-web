# Readable tabs and project writing space

The user wants the description to occupy at least 20% of the visible screen, while preserving the corrected compact header. This supersedes the earlier small empty-description preference. Custom properties remain excluded.

Google's current PrimaryNavigationTabTokens and SecondaryNavigationTabTokens use TitleSmall, a 14sp / 20sp medium style, and a 48dp text-only container. The web component uses equivalent default-scale CSS tokens. Compact tab gutters may adapt to the pane; the type must not shrink to force a fit. This is an adaptation of the tab metrics, not a claim that every Expressive component requirement has been audited.

Sources: https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/PrimaryNavigationTabTokens.kt and TypeScaleTokens.kt in the same directory. Context7 was unavailable due to quota; the Google-published sources were read directly.

- [x] Restore full tab typography and measure the compact lane from individual content widths.
- [x] Give the shared document a writing presentation with a minimum of max(12rem, 20svh), preserving natural growth and existing editing behavior.
- [x] Verify actual metrics, saving/reload and rendered desktop/phone states in both themes; record review and commit.
