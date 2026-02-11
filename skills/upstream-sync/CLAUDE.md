# Upstream Sync Skill

**Purpose**: Automatically check for upstream NanoClaw updates, rebase custom changes, resolve conflicts, test, and merge.

**Schedule**: Daily at 3 AM

---

## Your Task

When this skill runs, you should:

### 1. Check for Updates

```bash
cd /workspace/project
git fetch upstream
git log HEAD..upstream/main --oneline
```

If no new commits, report "No upstream updates" and exit.

### 2. If Updates Exist

Create a report at `/workspace/group/upstream-sync-report-YYYY-MM-DD.md` documenting:

**A. What Changed Upstream**
- List new commits from `git log HEAD..upstream/main`
- Summarize what features/fixes were added
- Identify files that might conflict with our customizations

**B. Review for Cherry-Picking**

DO NOT REBASE - our fork has fundamentally diverged (iMessage vs WhatsApp).

Instead, identify commits worth cherry-picking:
```bash
# Look for general improvements (not WhatsApp-specific)
git log HEAD..upstream/main --oneline

# Categorize each commit:
# - Bug fixes (scheduler, memory, security) → cherry-pick
# - WhatsApp features → skip
# - General improvements → evaluate
```

**C. Handle Conflicts**

If conflicts occur:
1. For each conflicting file, analyze:
   - What upstream changed
   - What we customized
   - Best resolution strategy

2. Resolution priority:
   - Keep our custom features (skills, WhatsApp integration, etc.)
   - Adopt upstream improvements where possible
   - Refactor our code to work with new upstream patterns
   - Document why we kept our version if different

3. Fix conflicts:
```bash
# Edit conflicting files
git add .
git rebase --continue
```

**D. Test the Rebase**

Run basic tests:
```bash
# Check if skills still load
ls /workspace/project/skills/

# Verify core functionality
# (add specific test commands as needed)
```

**E. Complete or Abort**

If tests pass:
```bash
git push origin main --force-with-lease
```

If tests fail:
```bash
git rebase --abort
```
Document failure reason in report.

### 3. Save Report

Save the detailed report to `/workspace/group/reports/upstream-sync-YYYY-MM-DD.md`

DO NOT send a message to Tim - this will be included in his 9 AM morning report.

---

## Conflict Resolution Guidelines

**Core Files We've Modified** (check these first):
- Skills system
- WhatsApp integration
- Agent collaboration features
- Any files in `/workspace/group/FORK-TRACKING.md`

**Resolution Strategy**:
1. **Prefer our code** for custom features
2. **Adopt upstream** for bug fixes and improvements
3. **Refactor our code** to match new upstream patterns when beneficial
4. **Document decisions** in the report

---

## Report Format

```markdown
# Upstream Sync Report - 2026-02-11

## Summary
- Status: ✅ Success / ⚠️ Conflicts / ℹ️ No updates
- Upstream commits: X
- Conflicts resolved: Y
- Tests: Passed/Failed

## Upstream Changes
- Commit abc123: Feature description
- Commit def456: Bug fix description

## Conflicts Resolved
### File: src/example.ts
- **Upstream change**: Added new function
- **Our modification**: Custom integration
- **Resolution**: Kept our version, added upstream improvement separately
- **Reason**: Our custom feature depends on current structure

## Tests Run
- ✅ Skills load correctly
- ✅ WhatsApp integration works
- ✅ Agent collaboration functional

## Next Steps
- None (auto-merged) / Manual review needed for [specific files]
```

---

## When to Escalate

Abort rebase and notify Tim if:
- Critical conflicts that could break core functionality
- Upstream removed features we depend on
- Tests fail after conflict resolution
- Unsure about best resolution strategy

**Better to pause and ask than break production.**
