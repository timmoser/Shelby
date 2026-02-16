# Add Heartbeat Skill

**Purpose**: Add OpenClaw-style heartbeat functionality to NanoClaw for proactive autonomous monitoring.

**Based on research**:

- [OpenClaw Heartbeat Documentation](https://docs.openclaw.ai/gateway/heartbeat)
- [OpenClaw Heartbeat Example](https://github.com/digitalknk/openclaw-runbook/blob/main/examples/heartbeat-example.md)

---

## What is Heartbeat?

Heartbeat transforms an agent from reactive (waits for user input) to **proactive** (autonomously checks things periodically).

**How it works**:

1. Every N minutes (default: 60), agent runs a turn automatically
2. Agent reads `HEARTBEAT.md` (standing instructions/checklist)
3. If nothing urgent → replies `HEARTBEAT_OK` (gets suppressed)
4. If something needs attention → sends notification

**Use cases**:

- Monitor for urgent items
- Check for updates/changes
- Proactive reminders
- Autonomous task completion

---

## Implementation Plan

### 1. Create HEARTBEAT.md Template

Create `/workspace/group/HEARTBEAT.md` with standing instructions:

```markdown
# Heartbeat Checklist

Run these checks every hour during work hours (9 AM - 6 PM Pacific):

## 🔔 Urgent Monitoring

- Check collaboration folder for messages from Dawn's agent
- Check for any system errors or failures
- Review scheduled task status (did 3 AM sync run?)

## 📊 Project Status

- Any Studio Moser deliverables waiting for Tim's review?
- Any blockers that need escalation?
- Any time-sensitive items approaching deadlines?

## 💡 Proactive Opportunities

- Upstream updates worth reviewing?
- Research completed that Tim should know about?
- Quick wins available (< 5 min tasks)?

## Response Protocol

- **If nothing urgent**: Reply `HEARTBEAT_OK`
- **If something needs attention**: Send brief notification with:
  - What needs attention
  - Why it's urgent
  - Recommended action

Keep notifications brief - Tim is busy. Only interrupt for things that matter.
```

### 2. Implement Heartbeat Scheduler

Add heartbeat scheduling to the scheduler system:

**File to modify**: `container/agent-runner/src/index.ts` or create new `heartbeat-scheduler.ts`

**Key features**:

- Configurable interval (default: 60 minutes)
- Active hours restriction (9 AM - 6 PM)
- Automatic suppression of `HEARTBEAT_OK` responses
- Integration with existing message queue

**Pseudo-code**:

```typescript
interface HeartbeatConfig {
  enabled: boolean;
  every: string; // "60m", "30m", etc.
  activeHours?: { start: number; end: number }; // 9-18 (9 AM - 6 PM)
  timezone?: string; // "America/Los_Angeles"
  prompt?: string; // Custom prompt override
}

async function scheduleHeartbeat(config: HeartbeatConfig) {
  const intervalMs = parseInterval(config.every);

  setInterval(async () => {
    // Check if within active hours
    if (!isWithinActiveHours(config.activeHours, config.timezone)) {
      return;
    }

    // Run agent turn
    const response = await runAgentTurn({
      prompt: config.prompt || 'Read HEARTBEAT.md and follow instructions',
      includeHeartbeatFile: true,
    });

    // Check for HEARTBEAT_OK (suppress)
    if (isHeartbeatOk(response)) {
      // Suppress - don't send to user
      log('Heartbeat: All clear');
      return;
    }

    // Something needs attention - send notification
    await sendMessage(response);
  }, intervalMs);
}

function isHeartbeatOk(response: string): boolean {
  const content = response.trim();

  // Check if starts or ends with HEARTBEAT_OK
  if (content.startsWith('HEARTBEAT_OK') || content.endsWith('HEARTBEAT_OK')) {
    // Remove HEARTBEAT_OK and check remaining length
    const remaining = content
      .replace(/^HEARTBEAT_OK\\s*/i, '')
      .replace(/\\s*HEARTBEAT_OK$/i, '')
      .trim();

    // Suppress if remaining content is short (< 300 chars)
    return remaining.length <= 300;
  }

  return false;
}
```

### 3. Add Configuration

Add heartbeat config to group settings:

**File**: `groups/main/CLAUDE.md` or create `groups/main/heartbeat-config.json`

```json
{
  "heartbeat": {
    "enabled": true,
    "every": "60m",
    "activeHours": {
      "start": 9,
      "end": 18,
      "timezone": "America/Los_Angeles"
    },
    "suppressOk": true,
    "maxSuppressedChars": 300
  }
}
```

### 4. Integration Points

**With Morning Report**:

- Heartbeat can add items to morning report queue
- Morning report reads heartbeat findings

**With Upstream Sync**:

- 3 AM sync saves results
- Next heartbeat after 9 AM can surface sync results if urgent

**With Agent Collaboration**:

- Heartbeat checks collaboration folder
- Surfaces urgent messages from Dawn's agent

---

## Implementation Steps

### Step 1: Create HEARTBEAT.md

```bash
# Create the heartbeat instructions file
cat > /workspace/group/HEARTBEAT.md << 'EOF'
[Template from above]
EOF
```

### Step 2: Implement Scheduler

Create new file or modify existing scheduler to add heartbeat support.

**Files to modify**:

- `container/agent-runner/src/index.ts` - Add heartbeat scheduler
- `container/agent-runner/src/heartbeat.ts` - New file with heartbeat logic
- `package.json` - Add any needed dependencies

### Step 3: Test

```bash
# Test heartbeat with short interval (5 minutes)
# Verify HEARTBEAT_OK suppression works
# Verify notifications sent when needed
# Verify active hours restriction works
```

### Step 4: Configure for Production

- Set interval to 60 minutes
- Set active hours to 9 AM - 6 PM Pacific
- Enable in config

---

## Expected Behavior

### Normal Operation (Nothing Urgent)

```
[9:00 AM] Heartbeat runs → "HEARTBEAT_OK" → Suppressed
[10:00 AM] Heartbeat runs → "HEARTBEAT_OK" → Suppressed
[11:00 AM] Heartbeat runs → "HEARTBEAT_OK" → Suppressed
```

### Something Needs Attention

```
[2:00 PM] Heartbeat runs → Detects Studio Moser deliverables waiting
→ Sends: "📬 Studio Moser inspiration board ready for review (2 days waiting)"
```

### Outside Active Hours

```
[8:00 PM] Heartbeat skipped (outside 9 AM - 6 PM window)
[3:00 AM] Heartbeat skipped (outside active hours)
```

---

## Token Cost Considerations

**Hourly cost** (9 AM - 6 PM = 9 hours):

- 9 heartbeat runs per day
- ~500 tokens per run (reading HEARTBEAT.md + thinking)
- = ~4,500 tokens/day
- = ~135,000 tokens/month

**If HEARTBEAT_OK** (most runs):

- No message sent to user
- Minimal cost

**Cost optimization**:

- Keep HEARTBEAT.md short (< 500 words)
- Use active hours restriction
- Suppress HEARTBEAT_OK responses
- Consider longer intervals (2 hours) if too chatty

---

## Testing Checklist

Before enabling in production:

- [ ] HEARTBEAT.md created and readable
- [ ] Heartbeat scheduler runs on interval
- [ ] Active hours restriction works
- [ ] HEARTBEAT_OK responses are suppressed
- [ ] Urgent items trigger notifications
- [ ] Integration with morning report works
- [ ] No infinite loops or crashes
- [ ] Token usage is acceptable

---

## Rollout Plan

**Phase 1: Test Mode** (1 week)

- Enable with 2-hour interval
- Monitor token usage
- Tune HEARTBEAT.md based on false positives

**Phase 2: Production** (ongoing)

- Switch to 1-hour interval
- Adjust active hours as needed
- Iterate on checklist based on Tim's feedback

---

## Your Task (When This Skill Runs)

1. Create `/workspace/group/HEARTBEAT.md` with the template above
2. Implement heartbeat scheduler in the codebase
3. Add configuration file
4. Test with short interval (5 min)
5. Document implementation in FORK-TRACKING.md
6. Commit changes
7. Report results to Tim

Be thorough - this is a core feature addition that runs autonomously.

---

**Sources**:

- [OpenClaw Heartbeat Documentation](https://docs.openclaw.ai/gateway/heartbeat)
- [OpenClaw Heartbeat Example](https://github.com/digitalknk/openclaw-runbook/blob/main/examples/heartbeat-example.md)
- [OpenClaw Config Example](https://gist.github.com/digitalknk/4169b59d01658e20002a093d544eb391)
