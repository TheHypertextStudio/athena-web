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

git config --local pull.ff only
git config --local pull.rebase true
git config --local branch.main.rebase true
git config --local branch.main.mergeOptions --ff-only
git config --local core.hooksPath "$hooks_dir"

cat > "$hooks_dir/pre-commit" <<'HOOK'
#!/bin/sh
set -eu

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required to run pre-commit checks." >&2
  exit 1
fi

exec pnpm lint-staged
HOOK

cat > "$hooks_dir/commit-msg" <<'HOOK'
#!/bin/sh
set -eu

exec node scripts/validate-commit-message.mjs "$1"
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
  "$hooks_dir/pre-commit" \
  "$hooks_dir/commit-msg" \
  "$hooks_dir/pre-merge-commit" \
  "$hooks_dir/prepare-commit-msg"

echo "Installed native Git guardrails in $hooks_dir"
