# NanoClaw Fork Tracking

**Purpose**: Document custom modifications to track during upstream syncs

**Last Updated**: 2026-02-11

---

## Upstream Information

**Original Repository**: https://github.com/gavrielc/nanoclaw
**Our Fork**: https://github.com/timmoser/Shelby

**Fork Status**: **PERMANENT DIVERGENCE**
- Upstream: WhatsApp-based
- Ours: iMessage-based (WhatsApp completely removed)
- Strategy: Cherry-pick improvements, never rebase

**Last Upstream Comparison**:
- Date: 2026-02-11
- Divergence point: 8eb80d4 (prevent infinite message replay)
- Our commits ahead: 4 major architectural changes
- Upstream commits behind: 0 (up to date as of fork)
- Files changed: 18 files, 2,455 insertions, 372 deletions

---

## Core Files Modified

### iMessage/Channel Architecture (Recent Major Changes)
- **Files**:
  - `container/agent-runner/src/index.ts`
  - `.claude/skills/add-imessage/SKILL.md`
  - `apply-imessage-integration.cjs`
  - Channel abstraction files
- **Customization**: Refactored to Channel architecture, converted from WhatsApp to iMessage
- **Recent Commits**:
  - `1c73042` - Update add-imessage skill for Channel architecture
  - `1614c91` - Convert iMessage to Channel architecture, remove WhatsApp
  - `ac68170` - Major improvements (iMessage, Telegram, collaboration, scheduler fix)
- **Conflict Strategy**: Critical custom implementation - preserve our iMessage integration

### Agent Collaboration & File Watching
- **Files**:
  - `container/agent-runner/src/file-watcher.sh`
  - `container/agent-runner/src/file-watcher.ts`
  - Collaboration folder implementation
- **Customization**: File watching system for agent-to-agent coordination
- **Reason**: Multi-agent workflow via shared filesystem
- **Conflict Strategy**: Keep our implementation, core feature

### Skills System Enhancements
- **Files**:
  - `.claude/skills/add-gmail/SKILL.md`
  - `.claude/skills/add-telegram/SKILL.md`
  - `.claude/skills/add-telegram-swarm/SKILL.md`
  - `.claude/skills/customize/SKILL.md`
  - `.claude/skills/debug/SKILL.md`
  - `.claude/skills/setup/SKILL.md`
  - `.claude/skills/x-integration/SKILL.md`
- **Customization**: Custom skill installations and configurations
- **Reason**: Extended functionality for our use cases
- **Conflict Strategy**: Keep our skills, merge if upstream adds skill management improvements

### Security & Performance Fixes
- **Files**: Various core files
- **Customization**:
  - Security review commits (899b29c, 31a6a69, 6a6fc5e)
  - Message loss fixes (48bdf3b, 48446ae)
  - Memory DoS fix (dfacafa)
  - Regex escape fix (0948add)
- **Recent Commits**: Multiple security and reliability improvements
- **Conflict Strategy**: These are bug fixes - adopt any upstream equivalents

### Container & Docker
- **Files**:
  - `container/Dockerfile`
  - `container/agent-runner/package.json`
  - `container/agent-runner/package-lock.json`
- **Customization**: Container configuration for our environment
- **Reason**: Custom dependencies and setup
- **Conflict Strategy**: Merge carefully - container changes can break everything

### Documentation Updates
- **Files**:
  - `CLAUDE.md`
  - `README.md`
  - `docs/DEBUG_CHECKLIST.md`
  - `docs/REQUIREMENTS.md`
  - `docs/SDK_DEEP_DIVE.md`
  - `docs/SPEC.md`
  - `groups/global/CLAUDE.md`
  - `groups/main/CLAUDE.md`
- **Customization**: Updated docs for our setup and workflows
- **Reason**: Keep documentation accurate for our fork
- **Conflict Strategy**: Low risk - merge upstream improvements, keep our custom sections

### Scheduler & Task Management
- **Files**: Task scheduler implementation
- **Customization**: Scheduler fixes (part of ac68170 commit)
- **Reason**: Reliable scheduled task execution
- **Conflict Strategy**: Keep our fixes unless upstream has better solution

### Heartbeat System
- **Files**:
  - `src/heartbeat-scheduler.ts`
  - `src/ipc.ts` (suppression logic)
  - `src/index.ts` (initialization)
  - `groups/main/HEARTBEAT.md`
  - `groups/main/heartbeat-config.json`
- **Customization**: OpenClaw-style proactive monitoring system
- **Reason**: Transform from reactive to proactive agent behavior
- **Recent Commits**: 2026-02-12 - Initial heartbeat implementation
- **Conflict Strategy**: Core custom feature - preserve entirely

---

## Sync History

### 2026-02-12 - Model Upgrade to Opus 4.6
- Switched from Claude Sonnet 4.5 to Claude Opus 4.6 for improved capabilities
- Modified agent runner to use `claude-opus-4-20250514` model
- Files modified:
  - `container/agent-runner/src/index.ts` (added model parameter to query options)
- **Rebuild required**: Run `cd container && ./build.sh` from host to rebuild container

### 2026-02-12 - Heartbeat Feature Implementation
- Implemented OpenClaw-style heartbeat functionality for proactive monitoring
- Added heartbeat scheduler module (`src/heartbeat-scheduler.ts`)
- Integrated HEARTBEAT_OK suppression in IPC message handler
- Created heartbeat configuration system (`groups/*/heartbeat-config.json`)
- Added automatic heartbeat initialization on startup
- Files modified:
  - `src/heartbeat-scheduler.ts` (new)
  - `src/ipc.ts` (added suppression logic)
  - `src/index.ts` (integrated initialization)
  - `groups/main/HEARTBEAT.md` (new)
  - `groups/main/heartbeat-config.json` (new)

**Feature Details**:
- Runs hourly during active hours (9 AM - 6 PM Pacific)
- Reads HEARTBEAT.md checklist for standing instructions
- Automatically suppresses HEARTBEAT_OK responses
- Uses existing task scheduler infrastructure
- Configurable interval and active hours per group

### 2026-02-11 - Initial Setup & Documentation
- Forked repository from anthropics/nanoclaw
- Setup upstream remote tracking
- Created automated sync skill (runs 3 AM daily)
- Documented all current modifications (47+ files modified in last 10 commits)
- Created morning report system (9 AM daily with sync results)

**Major Custom Work Identified**:
- iMessage/Channel architecture refactor (replacing WhatsApp)
- Agent collaboration via file watching
- Multiple security fixes (memory DoS, message loss, regex escaping)
- Custom skills (Telegram, Gmail, debugging, setup)
- Container configuration updates
- Scheduler reliability improvements

**Current State**: Fork is significantly diverged from upstream with custom iMessage implementation as core differentiator

---

## Conflict Resolution Principles

1. **Preserve Custom Features**: Our WhatsApp integration, skills system, and collaboration features are core to our use case
2. **Adopt Improvements**: Take upstream bug fixes and performance improvements
3. **Refactor When Beneficial**: If upstream introduces better patterns, adapt our code
4. **Document Decisions**: Every conflict resolution should be documented here
5. **Test Thoroughly**: Never merge without testing core functionality

---

## Testing Checklist

Before completing any upstream sync, verify:

- [ ] Skills load correctly (`ls /workspace/project/skills/`)
- [ ] WhatsApp integration works (check message handling)
- [ ] Agent collaboration features work (file watching, messaging)
- [ ] Custom commands/features still functional
- [ ] No breaking changes to APIs we depend on

---

## Notes

- Update this file whenever we modify core NanoClaw files
- Run `git log upstream/main..main --no-merges` to see our custom commits
- Keep patch files for critical customizations: `git format-patch upstream/main..main -o /workspace/project/custom-patches/`
