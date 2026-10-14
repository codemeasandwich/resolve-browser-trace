#!/usr/bin/env bash
# npm run release [version]
#
# Creates a GitHub release; the "Publish to npm with Provenance" workflow then publishes it to npm.
# Modelled on api-ape's scripts/publish.sh (same steps, same commit-type driven version bump), but it never amends
# or force-pushes commits and never deletes tags or releases: if something fails, fix it and run it again.
#
#   npm run release          bump from the commit messages since the last tag (feat! major, feat minor, else patch)
#   npm run release 1.2.0    release exactly that version
#
# If package.json already holds a version higher than npm's (for example 1.0.0 after 0.10.1), that version is used.
set -euo pipefail

PACKAGE_NAME=$(node -p "require('./package.json').name")
BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$BRANCH" != "main" && "$BRANCH" != "master" ]]; then
  echo "Error: release from main or master (you are on $BRANCH)." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: the working tree has uncommitted changes. Save them first." >&2
  exit 1
fi

TARGET_VERSION="${1:-}"
if [[ -n "$TARGET_VERSION" && ! "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: invalid version '$TARGET_VERSION'. Use semantic versioning, e.g. 1.2.3" >&2
  exit 1
fi

# Echoes 0 if equal, 1 if $1 > $2, 2 if $1 < $2
compare_versions() {
  local IFS=.
  local -a a=($1) b=($2)
  for i in 0 1 2; do
    if (( a[i] > b[i] )); then echo 1; return; fi
    if (( a[i] < b[i] )); then echo 2; return; fi
  done
  echo 0
}

echo "Step 1: tests with the 100% coverage threshold"
npm test

LOCAL_VERSION=$(node -p "require('./package.json').version")
NPM_VERSION=$(npm view "$PACKAGE_NAME" version 2>/dev/null || echo "0.0.0")
echo "Local version: $LOCAL_VERSION, npm version: $NPM_VERSION"

PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
RANGE="${PREV_TAG:+$PREV_TAG..}HEAD"

if [[ -n "$TARGET_VERSION" ]]; then
  NEW_VERSION="$TARGET_VERSION"
elif [[ $(compare_versions "$LOCAL_VERSION" "$NPM_VERSION") -eq 1 ]]; then
  NEW_VERSION="$LOCAL_VERSION"
else
  IFS=. read -r MAJOR MINOR PATCH <<< "$LOCAL_VERSION"
  SUBJECTS=$(git log "$RANGE" --format=%s)
  if grep -Eq '^[a-z]+!:|BREAKING CHANGE' <<< "$SUBJECTS"; then
    NEW_VERSION="$((MAJOR + 1)).0.0"
  elif grep -Eq '^feat(\(.*\))?:' <<< "$SUBJECTS"; then
    NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
  else
    NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
  fi
fi

if [[ $(compare_versions "$NEW_VERSION" "$NPM_VERSION") -ne 1 ]]; then
  echo "Error: $NEW_VERSION must be higher than the npm version $NPM_VERSION." >&2
  exit 1
fi
TAG="v$NEW_VERSION"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists." >&2
  exit 1
fi

if [[ "$NEW_VERSION" != "$LOCAL_VERSION" ]]; then
  echo "Step 2: setting version $NEW_VERSION"
  npm version "$NEW_VERSION" --no-git-tag-version --ignore-scripts >/dev/null
  git add package.json
  [[ -f package-lock.json ]] && git add package-lock.json
  git commit -m "build: release $TAG"
fi

echo "Step 3: pushing to origin"
git push origin HEAD

# Release notes: the commits since the previous tag, grouped by type
NOTES=""
add_section() { # title, extended regex of types
  local lines
  lines=$(git log "$RANGE" --format='- %s' | grep -E "^- ($2)(\(.*\))?!?:" || true)
  [[ -n "$lines" ]] && NOTES+=$'\n'"## $1"$'\n'"$lines"$'\n'
  return 0
}
add_section "Features" "feat"
add_section "Fixes" "fix|perf"
add_section "Other changes" "refactor|docs|build|ci|style|test"
[[ -z "$NOTES" ]] && NOTES="No notable changes in this release."

echo "Step 4: creating GitHub release $TAG"
printf '%s\n' "$NOTES" | gh release create "$TAG" --title "$TAG" --notes-file -

REPO=$(git remote get-url origin | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')
echo "Release $TAG created. The workflow publishes it to npm with provenance:"
echo "  https://github.com/$REPO/actions"
