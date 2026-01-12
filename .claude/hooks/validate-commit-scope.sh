#!/usr/bin/env bash
# PreToolUse hook to validate commit message scopes
# Reads JSON from stdin, validates git commit -m messages

# Read JSON input from stdin
INPUT=$(cat)

# Fast path: quick string checks before any JSON parsing
# Exit immediately if this isn't a Bash tool with a git commit command
[[ "$INPUT" != *'"Bash"'* ]] && exit 0
[[ "$INPUT" != *'git commit'* ]] && exit 0

# Now parse JSON (we know it's likely relevant)
# Use jq with error suppression - if JSON is malformed, skip validation
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0
[[ "$COMMAND" != *'git commit'* ]] && exit 0

# Extract commit message - handle heredoc, quoted, and unquoted formats
COMMIT_MSG=""

# Check for heredoc format: <<DELIMITER ... DELIMITER (arbitrary delimiter)
# Matches: <<EOF, <<'EOF', <<"EOF", <<COMMIT, <<'MSG', etc.
if [[ "$COMMAND" =~ \<\<[\'\"]?([A-Za-z_][A-Za-z0-9_]*)[\'\"]? ]]; then
  HEREDOC_DELIM="${BASH_REMATCH[1]}"
  # Extract content between delimiter markers using sed
  # The content appears after the opening delimiter line and before closing delimiter
  HEREDOC_CONTENT=$(echo "$COMMAND" | sed -n "/<<['\"]\\{0,1\\}${HEREDOC_DELIM}['\"]\\{0,1\\}/,/^${HEREDOC_DELIM}\$/p" | sed '1d;$d')
  if [[ -n "$HEREDOC_CONTENT" ]]; then
    # Get first line (the type(scope): description line)
    COMMIT_MSG=$(echo "$HEREDOC_CONTENT" | head -n1 | xargs)
  fi
fi

# Fallback to standard -m "message" or -m 'message' format
if [[ -z "$COMMIT_MSG" ]]; then
  if [[ "$COMMAND" =~ -m[[:space:]]+[\"\']([^\"\']+)[\"\'] ]]; then
    FULL_MSG="${BASH_REMATCH[1]}"
    # Get first line only for validation
    COMMIT_MSG=$(echo "$FULL_MSG" | head -n1)
  elif [[ "$COMMAND" =~ -m[[:space:]]+([^[:space:]]+) ]]; then
    COMMIT_MSG="${BASH_REMATCH[1]}"
  fi
fi

# If we still can't extract the message, skip validation
[[ -z "$COMMIT_MSG" ]] && exit 0

# Valid scopes from .claude/skills/commit.md
VALID_SCOPES=(
  # App-level
  "api" "web"
  # Packages
  "types" "test-utils" "mcp-server"
  # Domain features
  "tasks" "calendar" "events" "agenda" "auth" "billing" "ai"
  "notifications" "integrations" "sync" "settings" "search"
  "analytics" "attachments" "webhooks" "projects" "tags" "time-tracking"
  # UI-specific
  "ui" "layout" "dashboard" "command-palette"
  # Infrastructure
  "db" "config" "deps" "ci" "docs" "release"
)

# Valid commit types
VALID_TYPES=("feat" "fix" "chore" "refactor" "perf" "docs" "test" "ci")

# Parse commit message format: type(scope): description OR type: description
if [[ "$COMMIT_MSG" =~ ^([a-z]+)\(([a-z0-9-]+)\):[[:space:]]* ]]; then
  TYPE="${BASH_REMATCH[1]}"
  SCOPE="${BASH_REMATCH[2]}"
elif [[ "$COMMIT_MSG" =~ ^([a-z]+):[[:space:]]* ]]; then
  TYPE="${BASH_REMATCH[1]}"
  SCOPE=""
else
  # Invalid format
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "Invalid commit message format. Use: type(scope): description or type: description"
    }
  }'
  exit 0
fi

# Validate type
TYPE_VALID=false
for valid_type in "${VALID_TYPES[@]}"; do
  if [[ "$TYPE" == "$valid_type" ]]; then
    TYPE_VALID=true
    break
  fi
done

if [[ "$TYPE_VALID" == "false" ]]; then
  jq -n --arg type "$TYPE" --arg valid "$(IFS=, ; echo "${VALID_TYPES[*]}")" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "Invalid commit type: \($type). Valid types: \($valid)"
    }
  }'
  exit 0
fi

# feat commits MUST have a scope
if [[ "$TYPE" == "feat" ]] && [[ -z "$SCOPE" ]]; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "feat commits require a scope. Use: feat(scope): description"
    }
  }'
  exit 0
fi

# If scope is provided, validate it
if [[ -n "$SCOPE" ]]; then
  SCOPE_VALID=false
  for valid_scope in "${VALID_SCOPES[@]}"; do
    if [[ "$SCOPE" == "$valid_scope" ]]; then
      SCOPE_VALID=true
      break
    fi
  done

  if [[ "$SCOPE_VALID" == "false" ]]; then
    jq -n --arg scope "$SCOPE" --arg valid "$(IFS=, ; echo "${VALID_SCOPES[*]}")" '{
      "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "Invalid scope: \($scope). Valid scopes: \($valid)"
      }
    }'
    exit 0
  fi
fi

# Validation passed - allow the commit
exit 0
