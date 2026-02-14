# Upstream Sync Skill

**Purpose**: Check for upstream NanoClaw updates, cherry-pick relevant commits, validate, and report.

**Schedule**: Daily at 3 AM

**Strategy**: Cherry-pick only. This fork has permanently diverged (iMessage vs upstream WhatsApp). Never rebase or merge.

**Environment**: Runs unattended inside Apple Container. Project at `/workspace/project`, reports at `/workspace/group/reports/`.

---

## Token Efficiency

Keep token usage low throughout:
- Use `git log`, `git diff --name-only`, and `git status` for analysis — do not open files
- Only open files when resolving actual conflict markers (Step 5)
- Do not scan, refactor, or modify code that isn't conflicted
- Cross-reference `/workspace/project/FORK-TRACKING.md` for conflict strategies instead of re-analyzing our fork's purpose

---

## Step 0: Preflight

```bash
cd /workspace/project
git status --porcelain
```

If output is non-empty: write a report noting the dirty working tree, do not proceed. A dirty tree means a previous run left unfinished work.

Verify upstream remote:
```bash
git remote -v | grep upstream
```

If `upstream` is missing:
```bash
git remote add upstream https://github.com/qwibitai/nanoclaw.git
```

Fetch:
```bash
git fetch upstream --prune
```

If fetch fails (network error): write a report noting the failure, exit. Do not proceed with stale data.

## Step 1: Check for Updates

```bash
git log HEAD..upstream/main --oneline
```

If no new commits: write a brief "no updates" report and exit.

## Step 2: Create Safety Net

Before touching anything, create a rollback point:

```bash
HASH=$(git rev-parse --short HEAD)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
git branch backup/pre-sync-$HASH-$TIMESTAMP
git tag pre-sync-$HASH-$TIMESTAMP
```

Record the tag name — include it in the report and rollback instructions.

## Step 3: Analyze and Categorize Upstream Changes

**3A. List upstream commits:**
```bash
git log HEAD..upstream/main --oneline --no-merges
```

**3B. Get file-level impact:**
```bash
git diff --name-only HEAD..upstream/main
```

**3C. Bucket changed files by risk:**

| Category | Paths | Risk |
|----------|-------|------|
| Skills | `skills/`, `.claude/skills/` | Low — unlikely to conflict unless we edited an upstream skill |
| Source | `src/` | Medium — cross-reference with FORK-TRACKING.md "Core Files Modified" |
| Build/Config | `package.json`, `package-lock.json`, `tsconfig*.json`, `container/` | High — can break everything |
| Docs | `docs/`, `README.md`, `CLAUDE.md` | Low — check for conflicts with our custom docs |
| Other | tests, CI, misc | Generally safe |

**3D. Classify each commit:**
- **Cherry-pick**: Bug fixes, security fixes, general improvements that apply to our fork
- **Skip**: WhatsApp-specific features, changes to code we've completely replaced (e.g. WhatsApp channel)
- **Needs review**: Commits touching files listed in FORK-TRACKING.md's "Core Files Modified" section

Do NOT open file contents at this stage. Use only git commands.

## Step 4: Conflict Preview

Before cherry-picking, identify which commits are likely to conflict.

Get the list of files we've modified since diverging from upstream:
```bash
BASE=$(git merge-base HEAD upstream/main)
git diff --name-only $BASE..HEAD
```

For each commit planned for cherry-pick, get its changed files:
```bash
git diff-tree --no-commit-id --name-only -r <commit-hash>
```

If any files overlap between a commit's changes and our locally modified files, flag that commit as "likely to conflict" in the report. This gives advance warning without attempting the pick.

## Step 5: Cherry-Pick Commits

Apply each commit classified for cherry-pick, in chronological order:

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

## Step 6: Validation

```bash
cd /workspace/project

# TypeScript compilation
npm run build

# Test suite
npm test

# Skills integrity
ls skills/

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

## Step 7: Rollback on Failure

If validation fails and cannot be fixed:

```bash
git reset --hard pre-sync-$HASH-$TIMESTAMP
```

Document in the report:
- What was attempted
- What failed (include error output)
- The backup tag used for rollback
- Recommendation for manual review

## Step 8: Push Changes

If validation passes:
```bash
git push origin main
```

Use regular push, not `--force-with-lease`. Cherry-picks create new commits so force push should never be needed. If push fails (someone else pushed), document in report.

## Step 9: Update FORK-TRACKING.md

Append a new entry to the Sync History section of `/workspace/project/FORK-TRACKING.md`:

```markdown
### YYYY-MM-DD - Automated Upstream Sync
- Cherry-picked: [commit hashes and descriptions]
- Skipped: [commits and reasons]
- Conflicts resolved: [files and resolution strategy]
- Validation: Build [pass/fail], Tests [pass/fail]
```

## Step 10: Save Report

Save to `/workspace/group/reports/upstream-sync-YYYY-MM-DD.md`. If a report already exists for today, append a timestamp: `upstream-sync-YYYY-MM-DD-HHMM.md`.

**DO NOT send a message.** This report will be included in the 9 AM morning report.

### Report Format

```markdown
# Upstream Sync Report - YYYY-MM-DD

## Summary
- **Status**: [Success / Partial / Failed / Rolled Back / No Updates]
- **Upstream commits found**: N
- **Commits cherry-picked**: X
- **Commits skipped**: Y
- **Conflicts resolved**: Z
- **Validation**: Build [pass/fail], Tests [pass/fail]
- **Backup tag**: pre-sync-<hash>-<timestamp>

## File Buckets
### Source (src/) — Medium Risk
- [files with notes]
### Build/Config — High Risk
- [files]
### Skills — Low Risk
- [files]
### Docs/Other — Low Risk
- [files]

## Commits Applied
### <hash>: <description>
- **Type**: Bug fix / Feature / Improvement
- **Files**: [list]
- **Conflicts**: None / [file: resolution]
- **Decision**: Cherry-picked — [reason]

## Commits Skipped
### <hash>: <description>
- **Type**: WhatsApp-specific / Incompatible / Complex conflicts
- **Decision**: Skipped — [reason]

## Validation
- **Build**: pass/fail [error if failed]
- **Tests**: pass/fail [failing tests if failed]
- **Skills**: [verified]
- **Git status**: clean / [issues]

## Rollback
To undo this sync:
    git reset --hard pre-sync-<hash>-<timestamp>
Backup branch: backup/pre-sync-<hash>-<timestamp>

## Next Steps
- [None / Manual review needed for specific commits]
```

---

## When to Escalate

Abort and document (do not send a message — the morning report will surface it):
- Critical conflicts that could break core functionality
- Upstream removed features we depend on
- Validation fails after conflict resolution and rollback was performed
- More than 10 upstream commits (prioritize bug fixes and security, defer the rest)

**Better to roll back and report than break production.**

---

## Edge Cases

- **Multiple syncs in one day**: Backup tags include timestamps, so multiple runs are safe
- **Upstream force-pushes**: `git fetch upstream --prune` handles this
- **Already-applied commits**: If cherry-pick says "already applied", skip and note in report
