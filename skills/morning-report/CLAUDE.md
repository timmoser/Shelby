# Morning Report Skill

**Purpose**: Generate daily morning briefing for Tim at 9 AM combining overnight updates, project status, and priorities.

**Format**: Based on Google CC "Your Day Ahead" + Presidential Daily Brief structure

---

## Your Task

Generate a comprehensive but concise morning report using this format:

```markdown
# Good Morning! 📅 [Day, Month Date, Year]

[Personalized greeting - vary it daily, keep it energizing]

---

## 📊 Overnight Updates

### Upstream Changes Available

[Read latest from `/workspace/group/reports/upstream-sync-YYYY-MM-DD.md` if exists]

- **Status**: ✅ No upstream changes / ⚡ [N] new commits available
- **Recommended cherry-picks**: [count and one-line descriptions]
- **Conflicts expected**: [any flagged conflicts]
- **To apply**: `git cherry-pick <hashes>` (see report for details)

### Scheduled Tasks Completed

[Check for any completed tasks from overnight]

- [List completed tasks with brief results]
- [Or "No scheduled tasks ran overnight"]

### Research/Agent Work

[Check for any research reports in `/workspace/group/research/` or `/workspace/group/reports/`]

- [List any new research completed]
- [Or "No new research completed"]

---

## 🚀 Active Projects

[Read from `/workspace/group/profile.md` and recent session memory]

### Studio Moser

**Status**: [Current state from deliverables/memory]
**Next Action**: [What needs to happen next]
**Waiting On**: [You / Dawn / Decision]

### Dawn's Projects

**Website**: [Status update]
**Job Hunt**: [Any updates from her agent via collaboration folder]
**Next Action**: [What's needed]

### Ausra Photos

[If active, include status]

### [Other Active Projects]

[Include if recently worked on]

---

## ⚡ Today's Priorities

[Infer from recent work and blockers - recommend 1-3 items]

1. **[Highest priority]** - [Why this matters now]
2. **[Second priority]** - [Why this matters]
3. **[Third priority]** - [Why this matters]

[Or if unclear: "No urgent priorities identified - good day to review [project] or work on [backlog item]"]

---

## 🚧 Blockers & Questions

[Identify any blockers from recent sessions or project status]

- [Blocker 1]: [Brief description + what's needed to unblock]
- [Question 1]: [Decision needed]

[Or "No blockers - clear to execute"]

---

## 📬 Agent Inbox

[Check collaboration folder for messages from Dawn's agent]
[Check for any system notifications]

- [Message summary from Dawn's agent if any]
- [System notifications if any]

[Or "Inbox clear"]

---

## 💡 Recommendations

[Based on project status and recent activity, suggest 1-2 smart next moves]

- [Recommendation 1 with reasoning]
- [Recommendation 2 with reasoning]

---

**Report generated in**: [timestamp]
**Next report**: Tomorrow, 9 AM
**Questions?** Just ask anytime.
```

---

## Guidelines

### Tone & Style

- **Energizing**: Start day positively, make progress feel tangible
- **Scannable**: Use emojis, headers, bullets for quick reading
- **Actionable**: Every section should drive decisions or actions
- **Concise**: Under 500 words unless major news
- **Contextual**: Connect dots between projects like Google CC does

### What to Include

✅ Overnight work completed (sync, research, scheduled tasks)
✅ Active project status (not ALL projects, just active ones)
✅ Clear priorities for today (max 3)
✅ Blockers that need attention
✅ Smart recommendations based on context

### What to Avoid

❌ Status dump of every project
❌ Repeating yesterday's report
❌ Generic priorities ("review email")
❌ Long paragraphs
❌ Information Tim already knows

### Data Sources

**Read these files**:

- `/workspace/group/reports/upstream-sync-YYYY-MM-DD.md` - Overnight sync results
- `/workspace/group/profile.md` - Active projects and context
- `/workspace/group/session-memory.md` - Recent session summaries
- `/workspace/extra/collaboration/` - Messages from Dawn's agent
- `/workspace/group/research/` - Recent research outputs
- `/workspace/group/tasks/` - Team deliverables

**Infer priorities from**:

- Recent session work (what Tim was focused on)
- Blockers identified in past sessions
- Deliverables waiting for review
- Time-sensitive items (launches, deadlines)

### Smart Inference

**If no clear priorities**: Suggest based on:

- Projects with deliverables waiting (Studio Moser has inspiration board ready)
- Projects approaching milestones
- Items Tim mentioned wanting to work on
- Strategic opportunities (upstream improvements to review)

**If multiple blockers**: Prioritize by impact
**If no blockers**: Acknowledge smooth sailing, suggest proactive work

---

## Examples

### Example: Active Day with Updates

```markdown
# Good Morning! 📅 Tuesday, February 12, 2026

Ready to build something great today?

---

## 📊 Overnight Updates

### Upstream Changes Available

⚡ **3 new commits** available from upstream

- 2 bug fixes recommended for cherry-pick (scheduler, memory leak)
- 1 WhatsApp feature (skip)
- **To apply**: `git cherry-pick <hash1> <hash2>` — see sync report for details

### Scheduled Tasks Completed

✅ Upstream sync ran successfully (3 AM)
✅ Dawn's morning check-in scheduled

### Research/Agent Work

No new research overnight

---

## 🚀 Active Projects

### Studio Moser

**Status**: 3 deliverables ready for review

- Inspiration board (10 sites with analysis)
- Site structure plan
- Platform recommendation (Framer)
  **Next Action**: Review inspiration board, pick design direction
  **Waiting On**: Your review

### Dawn's Projects

**Website**: Strategy complete, waiting for essay collection
**Job Hunt**: Resume versions ready
**Next Action**: Dawn gathering personal essays (Priority 1)

---

## ⚡ Today's Priorities

1. **Review Studio Moser inspiration board** - Team waiting for design direction
2. **Review upstream sync report** — 2 bug fixes available for cherry-pick
3. **Check in with Dawn** - See if she needs help with essays

---

## 🚧 Blockers & Questions

- **Studio Moser**: Needs design direction choice before team can proceed
- **Dawn**: Waiting on personal essay collection

---

## 📬 Agent Inbox

Inbox clear

---

## 💡 Recommendations

- **Studio Moser**: 30 min review this morning unblocks the team
- **Upstream**: 2 bug fixes available — review sync report when you have a moment

---

**Report generated in**: 2.3s
**Next report**: Tomorrow, 9 AM
```

### Example: Quiet Day

```markdown
# Good Morning! 📅 Wednesday, February 13, 2026

Smooth sailing today - perfect for deep work.

---

## 📊 Overnight Updates

### Upstream Changes Available

✅ **No upstream changes** — fork up to date

### Scheduled Tasks Completed

✅ Upstream check ran (no updates)

---

## 🚀 Active Projects

### Studio Moser

**Status**: Building site structure in Framer
**Next Action**: Content gathering (client logos, portfolio images)

### Dawn's Projects

**Website**: In progress (Week 2 of 8)
**Job Hunt**: Active networking phase

---

## ⚡ Today's Priorities

No urgent priorities - good day for:

1. **Ausra Photos planning** - Haven't touched this in a while
2. **Studio Moser content prep** - Gather portfolio assets
3. **Strategic thinking** - Review year goals

---

## 🚧 Blockers & Questions

No blockers - clear to execute

---

## 📬 Agent Inbox

Inbox clear

---

## 💡 Recommendations

Perfect day to:

- Deep work on a product (Ausra Photos architecture?)
- Strategic planning session
- Explore new creative ideas

---

**Report generated in**: 1.8s
**Next report**: Tomorrow, 9 AM
```

---

## Edge Cases

**No overnight updates**: Still send report, focus on projects and priorities

**Multiple urgent items**: Prioritize by impact, suggest scheduling strategy

**Waiting on external input**: Acknowledge, suggest alternative productive work

**Technical issues**: Report them clearly with suggested next steps

**Dawn's agent offline**: Note it, don't block on it

---

## Success Metrics

Good morning report:

- ✅ Takes <2 min to read
- ✅ Tim knows exactly what happened overnight
- ✅ Clear on top 1-3 priorities
- ✅ Aware of blockers
- ✅ Feels energized to start day

Poor morning report:

- ❌ Too long (>5 min read)
- ❌ Just repeats yesterday
- ❌ No clear priorities
- ❌ Missing important updates
- ❌ Generic/templated feeling

---

**Remember**: This is Tim's first touchpoint of the day. Make it count. Energize, inform, prioritize, unblock.
