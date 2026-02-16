# Apply Upstream Skill

**Purpose**: Manually cherry-pick upstream commits into this fork, with safety net, conflict resolution, validation, and rollback.

**Trigger**: Manual only — never runs automatically.

**Strategy**: Cherry-pick only. This fork has permanently diverged (iMessage vs upstream WhatsApp). Never rebase or merge.

**Environment**: Runs inside Apple Container. Project at `/workspace/project`, reports at `/workspace/group/reports/`.

---

## Inputs

The user may specify:

- **Specific commit hashes** to cherry-pick
- **"all recommended"** — read the latest upstream sync report and cherry-pick everything marked "Recommended: Cherry-Pick"
- **Nothing** — default to "all recommended" from the latest sync report

If no sync report exists for today, run `git fetch upstream --prune` first and analyze manually using the approach in the upstream-sync skill.

---

## Token Efficiency

- Use `git log`, `git diff --name-only`, and `git status` for analysis — do not open files
- Only open files when resolving actual conflict markers
- Do not scan, refactor, or modify code that isn't conflicted
- Cross-reference `/workspace/project/FORK-TRACKING.md` for conflict strategies

---

## Step 1: Preflight

```bash
cd /workspace/project
git status --porcelain
```

If output is non-empty: **stop and report**. A dirty tree means uncommitted work that could be lost. Ask the user what to do.

Verify upstream is fetched:

```bash
git remote -v | grep upstream
git fetch upstream --prune
```

## Step 2: Create Safety Net

Before touching anything, create a rollback point:

```bash
HASH=$(git rev-parse --short HEAD)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
git branch backup/pre-sync-$HASH-$TIMESTAMP
git tag pre-sync-$HASH-$TIMESTAMP
```

Record the tag name — include it in the report and rollback instructions.

## Step 3: Determine Commits to Apply

If user specified hashes, use those.

Otherwise, read the latest sync report:

```bash
ls -t /workspace/group/reports/upstream-sync-*.md | head -1
```

Extract commit hashes from the "Recommended: Cherry-Pick" section.

If no commits are recommended, report that and exit.

## Step 4: Cherry-Pick Commits

Apply each commit in chronological order (oldest first):

```bash
git cherry-pick <hash>
```

**If clean (no conflicts):** Continue to next commit.

**If conflicts occur:**

1. `git status` to identify conflicted files
2. Open ONLY the conflicted files — do not scan other files
3. Resolve each conflict using these priorities:
   - **Keep our code** for: iMessage integration, heartbeat system, channel architecture, skills system, collaboration features
   - **Adopt upstream** for: bug fixes, security patches, performance improvements
   - **Merge both** when changes are in different sections of the file
   - Consult `/workspace/project/FORK-TRACKING.md` for file-specific strategies
4. `git add <resolved-file>`
5. `git cherry-pick --continue`

**If conflicts are too complex** (more than 5 conflicted files in a single commit, or changes to core architecture):

1. `git cherry-pick --abort`
2. Skip this commit
3. Document in report: "Skipped — complex conflicts, manual review needed"
4. Continue with remaining commits

## Step 5: Validation

```bash
cd /workspace/project

# TypeScript compilation
npm run build

# Test suite
npm test

# Clean git state
git status --porcelain
```

**If `npm run build` fails:**

- Check if the error is in a cherry-picked file
- If yes: fix the type error (missing import, type mismatch from merged code)
- If no: note as pre-existing in report, do not block the sync
- Do not refactor unrelated code

**If `npm test` fails:**

- Check if failing tests relate to cherry-picked changes
- If yes: attempt to fix
- If no: note as pre-existing in report

## Step 6: Rollback on Failure

If validation fails and cannot be fixed:

```bash
git reset --hard pre-sync-$HASH-$TIMESTAMP
```

Report what was attempted, what failed, and the backup tag used.

## Step 7: Push Changes

If validation passes:

```bash
git push origin main
```

Use regular push, not `--force-with-lease`. Cherry-picks create new commits so force push should never be needed. If push fails, document in report.

## Step 8: Update FORK-TRACKING.md

Append a new entry to the Sync History section of `/workspace/project/FORK-TRACKING.md`:

```markdown
### YYYY-MM-DD - Manual Upstream Sync

- Cherry-picked: [commit hashes and descriptions]
- Skipped: [commits and reasons]
- Conflicts resolved: [files and resolution strategy]
- Validation: Build [pass/fail], Tests [pass/fail]
```

## Step 9: Send Report

Send the user a summary of what was applied:

- Commits cherry-picked (with one-line descriptions)
- Commits skipped (with reasons)
- Conflicts resolved (files and strategy)
- Validation results (build/tests)
- Rollback instructions if needed

---

## Conflict Resolution Priorities

| Our Code (keep ours)         | Upstream Code (adopt theirs) |
| ---------------------------- | ---------------------------- |
| iMessage integration         | Bug fixes                    |
| Heartbeat system             | Security patches             |
| Channel architecture         | Performance improvements     |
| Skills system customizations | New utilities/helpers        |
| Collaboration features       | Test improvements            |

When in doubt, **keep our code** and document the skipped change for manual review.

---

## When to Stop

Stop and report (do not force through):

- Critical conflicts that could break core functionality
- Upstream removed features we depend on
- Validation fails after conflict resolution — rollback and report
- More than 5 conflicted files in a single commit

**Better to roll back and report than break production.**

---

## Edge Cases

- **Already-applied commits**: If cherry-pick says "already applied", skip and note
- **Empty cherry-pick**: If cherry-pick results in no changes (already incorporated), skip and note
- **User specifies invalid hash**: Report the error, continue with remaining hashes
