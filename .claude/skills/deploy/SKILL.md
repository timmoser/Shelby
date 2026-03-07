---
name: deploy
description: Commit, push, rebuild container, and restart NanoClaw service. Use when the user says "deploy", "ship it", "checkin and restart", or "push and rebuild".
---

# Deploy

Full deploy cycle: commit all changes, push to origin, rebuild the container image, and restart the NanoClaw service.

## Steps

1. **Check for changes** — run `git status` and `git diff`. If there are no changes, skip to step 4.

2. **Commit** — stage all modified/new files (exclude `.env`, credentials, secrets). Write a concise commit message summarizing the changes. Include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.

3. **Push** — `git push origin main`.

4. **Build host TypeScript** — `npm run build`. Stop and report if this fails.

5. **Rebuild container** (only if container-related files changed: `container/`, `Dockerfile`):
   - Reset builder: `container builder stop && container builder rm && container builder start`
   - Build: `./container/build.sh`
   - Clear cached agent-runner-src: `rm -rf ~/nanoclaw/data/sessions/*/agent-runner-src` (ignore glob errors)

6. **Restart service**:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
   launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
   ```

7. **Verify** — wait 3 seconds, then check `tail -15 ~/nanoclaw/logs/nanoclaw.log` for clean startup. Report success or any errors.

## Notes

- If only host files changed (no container/ changes), skip step 5 — just rebuild TypeScript and restart.
- If the commit fails due to pre-commit hooks, fix the issue and retry.
- Never commit `.env` files or files containing secrets.
