#!/bin/bash
# File watcher using inotifywait for push notifications
# Monitors IPC input directory and mounted folders for changes

set -e

# Directories to watch
WATCH_DIRS=(
  "/workspace/ipc/input"
  "/workspace/collaboration"
  "/workspace/icloud"
  "/workspace/group"
)

# Build inotifywait command with all existing directories
EXISTING_DIRS=()
for dir in "${WATCH_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    EXISTING_DIRS+=("$dir")
  fi
done

if [ ${#EXISTING_DIRS[@]} -eq 0 ]; then
  echo "[file-watcher] No directories to watch" >&2
  exit 0
fi

echo "[file-watcher] Watching: ${EXISTING_DIRS[*]}" >&2

# Monitor for file creation, modification, and moves
# Output one line per event for the agent runner to process
inotifywait -m -q \
  -e create -e moved_to -e modify -e close_write \
  --format '%w%f|%e' \
  "${EXISTING_DIRS[@]}" 2>/dev/null | while IFS='|' read -r filepath event; do

  # Skip temporary files and hidden files
  filename=$(basename "$filepath")
  if [[ "$filename" == .* ]] || [[ "$filename" == *~ ]] || [[ "$filename" == *.tmp ]]; then
    continue
  fi

  # Emit event on stdout for the agent runner
  echo "FILE_CHANGE|$filepath|$event"
done
