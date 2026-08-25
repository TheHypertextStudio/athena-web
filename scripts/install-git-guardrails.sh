#!/bin/sh
set -eu

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel)
git_common_dir=$(git -C "$repo_root" rev-parse --git-common-dir)

case "$git_common_dir" in
  /*) ;;
  *) git_common_dir="$repo_root/$git_common_dir" ;;
esac

hooks_dir="$git_common_dir/docket-hooks"
mkdir -p "$hooks_dir"

cat > "$hooks_dir/use-repo-node.sh" <<'HOOK'
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

git config --local pull.ff only
git config --local pull.rebase true
git config --local branch.main.rebase true
git config --local branch.main.mergeOptions --ff-only
git config --local core.hooksPath "$hooks_dir"

rm -f "$hooks_dir/pre-commit"

cat > "$hooks_dir/commit-msg" <<'HOOK'
#!/bin/sh
set -eu

. "$(dirname "$0")/use-repo-node.sh"

node scripts/validate-commit-message.mjs "$1"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required to run commit checks." >&2
  exit 1
fi

# Validate attribution and message policy before starting the expensive quality gate. Git runs
# pre-commit before it prepares the message, so leaving lint there made an invalid agent commit
# wait for the whole repository lint before commit-msg could reject it.
pnpm lint-staged

# lint-staged only formats indexed files. The full lint below is the one authoritative check: a
# prior commit can otherwise leave a package lint failure behind when a later commit changes
# unrelated files. CI lints the complete workspace, so commits must do the same before they create
# a revision that can later reach main.
NODE_OPTIONS=--max-old-space-size=3072 pnpm turbo run lint --concurrency=1
HOOK

cat > "$hooks_dir/pre-merge-commit" <<'HOOK'
#!/bin/sh

echo "Merge commits are forbidden in this repository. Rebase, cherry-pick, or use git merge --ff-only." >&2
exit 1
HOOK

cat > "$hooks_dir/prepare-commit-msg" <<'HOOK'
#!/bin/sh
set -eu

git_dir=$(git rev-parse --git-dir 2>/dev/null || true)

if [ -n "$git_dir" ] && [ -f "$git_dir/MERGE_HEAD" ]; then
  echo "Merge commits are forbidden in this repository. Abort the merge and replay with rebase, cherry-pick, or git merge --ff-only." >&2
  exit 1
fi

exit 0
HOOK

chmod +x \
  "$hooks_dir/use-repo-node.sh" \
  "$hooks_dir/commit-msg" \
  "$hooks_dir/pre-merge-commit" \
  "$hooks_dir/prepare-commit-msg"

echo "Installed native Git guardrails in $hooks_dir"
