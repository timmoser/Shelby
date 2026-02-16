# Backup Skill

**Purpose**: Daily backup of critical NanoClaw data to prevent data loss.

**Schedule**: 4 AM daily (after 3 AM upstream sync)

---

## What Gets Backed Up

### Critical Data

1. **Messages Database** - `/workspace/project/store/messages.db`
   - iMessage history
   - Registered groups
   - Scheduled tasks
   - Chat metadata

2. **Group Workspace** - `/workspace/group/`
   - profile.md (Tim's context)
   - session-memory.md (conversation summaries)
   - HEARTBEAT.md (monitoring checklist)
   - heartbeat-config.json
   - All research reports
   - All task deliverables

3. **Session History** - `/workspace/project/data/sessions/`
   - Full conversation transcripts per group
   - Agent settings and state
   - Todo lists

4. **Group Configs** - `/workspace/project/groups/`
   - CLAUDE.md instructions per group
   - Group-specific configurations

5. **Fork Tracking** - `/workspace/project/FORK-TRACKING.md`
   - Custom modifications documentation

---

## Backup Strategy

### Local Backups (Primary)

**Location**: `/workspace/project/backups/YYYY-MM-DD-HHMM/`

**Retention**: Keep last 7 daily backups, then weekly for 4 weeks

**Format**: Timestamped directories with full copies

### Git Backups (Secondary)

**Location**: Separate `backups` branch in GitHub repo

**What**: Databases and critical configs (not full session history - too large)

**Retention**: Git history serves as backup timeline

### iCloud Sync (Tertiary)

**Location**: `/workspace/extra/icloud/backups/`

**What**: Latest backup copy for off-machine redundancy

---

## Your Task

When this skill runs at 4 AM:

### 1. Create Backup Directory

```bash
TIMESTAMP=$(date +%Y-%m-%d-%H%M)
BACKUP_DIR="/workspace/project/backups/$TIMESTAMP"
mkdir -p "$BACKUP_DIR"
```

### 2. Backup Databases

```bash
# Messages database (critical!)
cp /workspace/project/store/messages.db "$BACKUP_DIR/"

# Session data
cp -r /workspace/project/data/sessions "$BACKUP_DIR/"
```

### 3. Backup Configurations

```bash
# Group workspace
cp -r /workspace/group "$BACKUP_DIR/"

# Group configs
cp -r /workspace/project/groups "$BACKUP_DIR/"

# Fork tracking
cp /workspace/project/FORK-TRACKING.md "$BACKUP_DIR/"
```

### 4. Create Backup Manifest

```bash
cat > "$BACKUP_DIR/MANIFEST.md" << EOF
# Backup Manifest

**Date**: $(date)
**Backup ID**: $TIMESTAMP

## Contents

\`\`\`
$(ls -lhR "$BACKUP_DIR")
\`\`\`

## Database Sizes
- messages.db: $(du -h /workspace/project/store/messages.db | cut -f1)
- Session data: $(du -sh /workspace/project/data/sessions | cut -f1)

## File Counts
- Total files backed up: $(find "$BACKUP_DIR" -type f | wc -l)
- Group workspace files: $(find "$BACKUP_DIR/group" -type f | wc -l)

## Verification
- [ ] messages.db readable
- [ ] Session data complete
- [ ] Group configs present
- [ ] FORK-TRACKING.md exists

Backup created by Shelby's automated backup skill.
EOF
```

### 5. Cleanup Old Backups

```bash
# Keep last 7 daily backups
cd /workspace/project/backups
ls -t | tail -n +8 | xargs -r rm -rf

# Create weekly snapshot every Sunday
if [ $(date +%u) -eq 7 ]; then
  WEEKLY_DIR="/workspace/project/backups/weekly-$(date +%Y-W%V)"
  cp -r "$BACKUP_DIR" "$WEEKLY_DIR"
fi
```

### 6. Sync to iCloud (Optional)

```bash
# Copy latest backup to iCloud for off-machine redundancy
if [ -d "/workspace/extra/icloud" ]; then
  cp -r "$BACKUP_DIR" "/workspace/extra/icloud/backups/latest"
fi
```

### 7. Git Backup (Compressed)

```bash
# Create compressed backup for git
cd /workspace/project
tar -czf "backups/backup-$TIMESTAMP.tar.gz" \
  store/messages.db \
  groups/ \
  FORK-TRACKING.md

# Commit to backups branch (don't bloat main branch)
git checkout -b backups 2>/dev/null || git checkout backups
cp "backups/backup-$TIMESTAMP.tar.gz" .
git add "backup-$TIMESTAMP.tar.gz"
git commit -m "Automated backup: $TIMESTAMP"
git push origin backups
git checkout main
```

### 8. Report Status

Save report to `/workspace/group/reports/backup-YYYY-MM-DD.md`:

```markdown
# Backup Report - [Date]

**Status**: ✅ Success / ⚠️ Partial / ❌ Failed
**Backup ID**: [timestamp]
**Size**: [total size]
**Duration**: [seconds]

## What Was Backed Up

- Messages DB: [size]
- Session history: [file count]
- Group workspace: [size]
- Group configs: [file count]

## Backup Locations

- Local: `/workspace/project/backups/[timestamp]/`
- iCloud: `/workspace/extra/icloud/backups/latest/`
- Git: `backups` branch (compressed)

## Retention

- Daily backups kept: 7
- Weekly backups kept: 4
- Oldest backup: [date]

## Verification

All critical files verified readable ✅

## Next Backup

Tomorrow 4 AM

---

_Automated backup completed successfully_
```

---

## Recovery Procedures

### Restore from Latest Backup

```bash
# Find latest backup
LATEST=$(ls -t /workspace/project/backups | head -1)

# Restore messages database
cp "/workspace/project/backups/$LATEST/messages.db" /workspace/project/store/

# Restore group workspace
cp -r "/workspace/project/backups/$LATEST/group/"* /workspace/group/

# Restore session data
cp -r "/workspace/project/backups/$LATEST/sessions/"* /workspace/project/data/sessions/
```

### Restore from Git

```bash
# Checkout backups branch
git fetch origin backups
git checkout backups

# Extract latest backup
tar -xzf backup-*.tar.gz -C /workspace/project/
```

### Restore from iCloud

```bash
# Copy from iCloud sync
cp -r /workspace/extra/icloud/backups/latest/* /workspace/project/
```

---

## Monitoring

Include backup status in morning report:

- Last backup time
- Backup size
- Any failures or warnings
- Disk space remaining

Alert Tim if:

- Backup fails
- Disk space < 1GB
- Database corruption detected
- Backup size anomalies (too large/small)

---

## Testing

**Monthly recovery test**:

1. Create test environment
2. Restore from 1-week-old backup
3. Verify all data intact
4. Check conversations load correctly
5. Verify scheduled tasks restored

**Document test results** in `/workspace/group/reports/backup-test-YYYY-MM.md`

---

## Disk Space Management

**Monitor**:

- `/workspace/project/backups/` size
- Available disk space
- Growth rate

**Cleanup if needed**:

- Reduce daily retention (7 → 5 days)
- Reduce weekly retention (4 → 2 weeks)
- Compress old backups
- Move to external storage

---

## Success Criteria

✅ Backup completes in < 30 seconds
✅ All critical files copied
✅ Manifest created with verification
✅ Old backups cleaned up
✅ Multiple backup locations (local, git, iCloud)
✅ Silent (no notification unless failure)

---

**Run this backup daily at 4 AM. Include status in 9 AM morning report.**
