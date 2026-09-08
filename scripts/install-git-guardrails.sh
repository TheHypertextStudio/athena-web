#!/bin/sh
set -eu

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel)
git_dir=$(git -C "$repo_root" rev-parse --git-dir)
guardrails_changed=0

case "$git_dir" in
  /*) ;;
  *) git_dir="$repo_root/$git_dir" ;;
esac

# Linked worktrees share the common Git directory. Keeping generated hooks there lets an older
# checkout overwrite this worktree's policy whenever it runs `pnpm install`. Worktree config gives
# each checkout its own hook path under its own Git directory, so the hook always matches the code
# that invoked it.
if [ "$(git config --local --get extensions.worktreeConfig 2>/dev/null || true)" != true ]; then
  git config --local extensions.worktreeConfig true
  guardrails_changed=1
fi
hooks_dir="$git_dir/docket-hooks"
mkdir -p "$hooks_dir"

write_hook() {
  hook_target=$1
  hook_temp="$hook_target.tmp.$$"
  trap 'rm -f "$hook_temp"' EXIT HUP INT TERM
  cat >"$hook_temp"
  if [ -f "$hook_target" ] && cmp -s "$hook_temp" "$hook_target"; then
    rm -f "$hook_temp"
  else
    mv -f "$hook_temp" "$hook_target"
    guardrails_changed=1
  fi
  if [ ! -x "$hook_target" ]; then
    chmod +x "$hook_target"
    guardrails_changed=1
  fi
  trap - EXIT HUP INT TERM
}

write_hook "$hooks_dir/use-repo-node.sh" <<'HOOK'
#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

if [ -s "$repo_root/.nvmrc" ]; then
  nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$nvm_dir/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$nvm_dir/nvm.sh"
    old_pwd=$(pwd)
    cd "$repo_root"
    # `|| true`: selecting the pinned Node is an optimization, not a requirement. `nvm use` exits
    # non-zero when `.nvmrc` names a version this machine has not installed, and under `set -e`
    # that killed the hook before it ran anything — every commit on the machine failed, silently
    # and with no output, because the hook died before reaching the validator that prints.
    #
    # Falling back to whatever Node is on PATH is safe: `engines` in package.json is the real
    # floor (`>=24.15 <27`), and pnpm enforces it. `.nvmrc` only says which of the legal versions
    # to prefer, so being one minor behind it must never be fatal. This is not hypothetical —
    # bumping `.nvmrc` to 26 blocked committing for everyone still on 24, which the same commit's
    # own `engines` range explicitly allows.
    nvm use --silent >/dev/null 2>&1 || true
    cd "$old_pwd"
  fi
fi
HOOK

if [ "$(git config --local --get pull.ff 2>/dev/null || true)" != only ]; then
  git config --local pull.ff only
  guardrails_changed=1
fi
if [ "$(git config --local --get pull.rebase 2>/dev/null || true)" != true ]; then
  git config --local pull.rebase true
  guardrails_changed=1
fi
if [ "$(git config --local --get branch.main.rebase 2>/dev/null || true)" != true ]; then
  git config --local branch.main.rebase true
  guardrails_changed=1
fi
if [ "$(git config --local --get branch.main.mergeOptions 2>/dev/null || true)" != --ff-only ]; then
  git config --local branch.main.mergeOptions --ff-only
  guardrails_changed=1
fi
if [ "$(git config --worktree --get core.hooksPath 2>/dev/null || true)" != "$hooks_dir" ]; then
  git config --worktree core.hooksPath "$hooks_dir"
  guardrails_changed=1
fi

write_hook "$hooks_dir/pre-commit" <<'HOOK'
#!/bin/sh
set -eu

. "$(dirname "$0")/use-repo-node.sh"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required to run commit checks." >&2
  exit 1
fi

# Reject credential-shaped tracked content before formatting can obscure which change introduced it.
pnpm secret-scan

# Git snapshots the index after pre-commit but before commit-msg. Formatting any later leaves the
# rewritten files staged for a second commit while the first commit records the unformatted input.
pnpm lint:staged

# ESLint cannot detect raw visual utilities. Run the focused design-policy gate so a typography,
# spacing, color, or shadow regression fails at the commit that introduced it instead of reaching
# CI.
pnpm --filter @docket/test-utils exec vitest run tests/design-policies/design-token-policy.test.ts --maxWorkers=1
HOOK

write_hook "$hooks_dir/commit-msg" <<'HOOK'
#!/bin/sh
set -eu

. "$(dirname "$0")/use-repo-node.sh"

node scripts/validate-commit-message.mjs "$1"
HOOK

write_hook "$hooks_dir/pre-merge-commit" <<'HOOK'
#!/bin/sh

echo "Merge commits are forbidden in this repository. Rebase, cherry-pick, or use git merge --ff-only." >&2
exit 1
HOOK

write_hook "$hooks_dir/prepare-commit-msg" <<'HOOK'
#!/bin/sh
set -eu

git_dir=$(git rev-parse --git-dir 2>/dev/null || true)

if [ -n "$git_dir" ] && [ -f "$git_dir/MERGE_HEAD" ]; then
  echo "Merge commits are forbidden in this repository. Abort the merge and replay with rebase, cherry-pick, or git merge --ff-only." >&2
  exit 1
fi

exit 0
HOOK

write_hook "$hooks_dir/pre-push" <<'HOOK'
#!/bin/sh
set -eu

. "$(dirname "$0")/use-repo-node.sh"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required to run pre-push checks." >&2
  exit 1
fi

# A direct push is the repository's integration boundary, so it runs the complete local gates.
pnpm typecheck
pnpm lint
pnpm test
HOOK

if [ "$guardrails_changed" -eq 1 ]; then
  echo "CHANGE native Git guardrails reconciled in $hooks_dir"
else
  echo "PASS native Git guardrails converged in $hooks_dir"
fi
