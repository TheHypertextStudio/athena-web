# Codex Custom Prompts

Custom prompts for OpenAI Codex CLI and IDE extension. These work on a per-project basis from `.codex/prompts/`.

## Available Prompts

| Prompt                | Description                      | Arguments                                                                       |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| `validate`            | Run typecheck, lint, and tests   | -                                                                               |
| `status`              | Display project status           | -                                                                               |
| `commit`              | Prepare and execute a git commit | -                                                                               |
| `docs`                | Generate/update documentation    | `TARGET=<api\|path\|check>`                                                     |
| `plan`                | Create implementation plan       | `TASK="<description>"`                                                          |
| `retro`               | Retrospective on completed work  | `TASK_ID=<id>`                                                                  |
| `worklog`             | View/update work log             | `ACTION=<view\|add\|start\|done>` `TASK="<task>"`                               |
| `audit-performance`   | Performance bottleneck audit     | `SCOPE=<session\|full\|frontend\|backend>`                                      |
| `audit-security`      | Security vulnerability audit     | `SCOPE=<session\|full\|auth\|authz\|input\|crypto\|api>`                        |
| `audit-accessibility` | WCAG compliance audit            | `SCOPE=<session\|full\|perceivable\|operable\|understandable\|robust>`          |
| `audit-code-quality`  | Code quality audit               | `SCOPE=<session\|full\|dead-code\|duplication\|complexity\|types\|tests\|deps>` |
| `audit-tests`         | Test validity audit              | `SCOPE=<session\|full\|unit\|integration\|e2e\|all>`                            |

### Audit Scope Options

All audit commands default to `SCOPE=session` which only audits uncommitted changes:

- **`session` (default)**: Audit only files with uncommitted changes (from `git status`)
- **`full`**: Audit entire codebase - use explicitly with `SCOPE=full`
- **Other scopes**: Target specific areas (e.g., `SCOPE=auth` for security audit)

## Usage Examples

```bash
# Basic usage
/prompts:validate
/prompts:status
/prompts:commit

# Audit commands (default to session scope - changed files only)
/prompts:audit-code-quality                  # Audits only uncommitted changes
/prompts:audit-security                      # Audits only uncommitted changes
/prompts:audit-code-quality SCOPE=full       # Audits entire codebase
/prompts:audit-security SCOPE=auth           # Targeted audit (auth only)

# Other commands with arguments
/prompts:plan TASK="Add user authentication with OAuth"
/prompts:worklog ACTION=add TASK="Implement dark mode"
```

## Updating

These prompts are mirrored from `.claude/skills/`. To sync changes:

```bash
# From repo root
cp .claude/skills/*/SKILL.md .codex/prompts/
# Then update front matter (remove name:, add argument-hint:)
```
