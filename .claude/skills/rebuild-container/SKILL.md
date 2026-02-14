---
name: rebuild-container
description: Clean rebuild of the nanoclaw agent container image, including cache invalidation and verification
---

# Rebuild Container

Perform a fully clean rebuild of the NanoClaw agent container. Apple Container's buildkit caches aggressively — `--no-cache` alone does NOT invalidate COPY steps. This skill handles the full teardown-and-rebuild sequence.

## Steps

1. **Stop and remove the builder** to flush stale cache:
   ```bash
   container builder stop && container builder rm && container builder start
   ```

2. **Run the build script**:
   ```bash
   ./container/build.sh
   ```

3. **Verify the rebuild** — confirm the built image contains current source:
   ```bash
   container run -i --rm --entrypoint wc nanoclaw-agent:latest -l /app/src/index.ts
   ```
   Compare the line count against the local `container/agent-runner/src/index.ts` to ensure the COPY was not stale.

4. **Report result** — tell the user whether the rebuild succeeded and whether the line counts match.

## When to Use

- After modifying files in `container/agent-runner/`
- After updating `container/Dockerfile`
- After updating container dependencies (`container/agent-runner/package.json`)
- When agents behave unexpectedly and you suspect stale container image
- When the user says "rebuild container" or "update container"

## Troubleshooting

If `container builder stop` fails, the builder may not be running. That's fine — proceed with `container builder rm` and `container builder start`.

If the build itself fails, check:
- `container/Dockerfile` syntax
- Network connectivity (npm install inside container)
- Disk space (`container builder prune` if needed)
