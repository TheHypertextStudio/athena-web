# Codex Custom Prompts

Custom prompts for OpenAI Codex CLI and IDE extension. These work on a per-project basis from `.codex/prompts/`.

## Available Prompts

| Prompt                | Description                      | Arguments                                                              |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `validate`            | Run typecheck, lint, and tests   | -                                                                      |
| `status`              | Display project status           | -                                                                      |
| `commit`              | Prepare and execute a git commit | -                                                                      |
| `docs`                | Generate/update documentation    | `TARGET=<api\|path\|check>`                                            |
| `plan`                | Create implementation plan       | `TASK="<description>"`                                                 |
| `retro`               | Retrospective on completed work  | `TASK_ID=<id>`                                                         |
| `worklog`             | View/update work log             | `ACTION=<view\|add\|start\|done>` `TASK="<task>"`                      |
| `audit-performance`   | Performance bottleneck audit     | `SCOPE=<full\|frontend\|backend>`                                      |
| `audit-security`      | Security vulnerability audit     | `SCOPE=<full\|auth\|authz\|input\|crypto\|api>`                        |
| `audit-accessibility` | WCAG compliance audit            | `SCOPE=<full\|perceivable\|operable\|understandable\|robust>`          |
| `audit-code-quality`  | Code quality audit               | `SCOPE=<full\|dead-code\|duplication\|complexity\|types\|tests\|deps>` |
| `audit-tests`         | Test validity audit              | `SCOPE=<unit\|integration\|e2e\|all>`                                  |

## Usage Examples

```bash
# Basic usage
/prompts:validate
/prompts:status
/prompts:commit

# With arguments
/prompts:plan TASK="Add user authentication with OAuth"
/prompts:audit-security SCOPE=auth
/prompts:worklog ACTION=add TASK="Implement dark mode"
```

## Updating

These prompts are mirrored from `.claude/skills/`. To sync changes:

```bash
# From repo root
cp .claude/skills/*/SKILL.md .codex/prompts/
# Then update front matter (remove name:, add argument-hint:)
```
