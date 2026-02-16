# Upstream Sync Skill

**Purpose**: Check for upstream NanoClaw updates and report what's changed. **Does NOT apply any changes** — all cherry-picking is done manually.

**Schedule**: Daily at 3 AM

**Strategy**: Report-only. This fork has permanently diverged (iMessage vs upstream WhatsApp). The automated process only fetches and analyzes — a human reviews the report and runs cherry-picks manually.

**Environment**: Runs unattended inside Apple Container. Project at `/workspace/project`, reports at `/workspace/group/reports/`.

---

## Token Efficiency

Keep token usage low throughout:

- Use `git log`, `git diff --name-only`, and `git status` for analysis — do not open files
- Cross-reference `/workspace/project/FORK-TRACKING.md` for conflict strategies instead of re-analyzing our fork's purpose
- This is a read-only operation — never modify the working tree

---

## Step 0: Preflight

```bash
cd /workspace/project
```

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

If fetch fails (network error): write a report noting the failure, exit.

## Step 1: Check for Updates

```bash
git log HEAD..upstream/main --oneline
```

If no new commits: write a brief "no updates" report and exit.

## Step 2: Analyze Upstream Changes

**2A. List upstream commits:**

```bash
git log HEAD..upstream/main --oneline --no-merges
```

**2B. Get file-level impact:**

```bash
git diff --name-only HEAD..upstream/main
```

**2C. Bucket changed files by risk:**

| Category     | Paths                                                               | Risk                                                                 |
| ------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Skills       | `skills/`, `.claude/skills/`                                        | Low — unlikely to conflict unless we edited an upstream skill        |
| Source       | `src/`                                                              | Medium — cross-reference with FORK-TRACKING.md "Core Files Modified" |
| Build/Config | `package.json`, `package-lock.json`, `tsconfig*.json`, `container/` | High — can break everything                                          |
| Docs         | `docs/`, `README.md`, `CLAUDE.md`                                   | Low — check for conflicts with our custom docs                       |
| Other        | tests, CI, misc                                                     | Generally safe                                                       |

**2D. Classify each commit:**

- **Recommend cherry-pick**: Bug fixes, security fixes, general improvements that apply to our fork
- **Recommend skip**: WhatsApp-specific features, changes to code we've completely replaced
- **Needs review**: Commits touching files listed in FORK-TRACKING.md's "Core Files Modified" section

Do NOT open file contents. Use only git commands.

## Step 3: Conflict Prediction

Identify which commits are likely to conflict if cherry-picked.

Get the list of files we've modified since diverging from upstream:

```bash
BASE=$(git merge-base HEAD upstream/main)
git diff --name-only $BASE..HEAD
```

For each recommended commit, get its changed files:

```bash
git diff-tree --no-commit-id --name-only -r <commit-hash>
```

If any files overlap between a commit's changes and our locally modified files, flag that commit as "likely to conflict."

## Step 4: Save Report

Save to `/workspace/group/reports/upstream-sync-YYYY-MM-DD.md`. If a report already exists for today, append a timestamp.

**DO NOT send a message.** This report will be included in the 9 AM morning report.

### Report Format

Use this structure for the report file:

**Sections to include:**

1. **Summary** — Status (Updates Available / No Updates), commit counts, recommended cherry-pick count, skip count, likely conflict count
2. **Commits Available** — Grouped into three sub-sections:
   - **Recommended: Cherry-Pick** — For each: hash, description, type, files changed, conflict risk, reasoning
   - **Recommended: Skip** — For each: hash, description, type, reasoning
   - **Needs Manual Review** — For each: hash, description, type, files, reasoning
3. **Cherry-Pick Commands** — Ready-to-paste commands: `cd /path/to/nanoclaw && git cherry-pick <hashes> && npm run build && npm test`
4. **File Risk Summary** — Bucketed by category (Source/Build/Skills/Docs) with risk levels

---

## Important Rules

1. **NEVER cherry-pick, merge, rebase, or modify the working tree** — this is a read-only analysis
2. **NEVER push anything** — the human handles all changes
3. **NEVER create backup branches or tags** — nothing is being modified
4. Only use `git fetch`, `git log`, `git diff`, and `git diff-tree`
5. Save the report and exit
