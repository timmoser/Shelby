# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation

FROM node:22-slim

# Install system dependencies for Chromium and inotify
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    inotify-tools \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser, claude-code, and MCP servers globally
# Skip Playwright browser download during npm install — we install it explicitly below
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install -g agent-browser @anthropic-ai/claude-code \
    @upstash/context7-mcp @playwright/mcp

# Install Playwright's bundled Chromium at build time so it doesn't download at runtime.
# Playwright MCP calls `playwright install chrome` on startup; having it pre-installed skips that.
# Browsers install to /root/.cache/ms-playwright/ — point PLAYWRIGHT_BROWSERS_PATH so the
# non-root node user can find them at runtime.
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
RUN npx playwright install --with-deps chromium && chmod -R o+rx /root/.cache/ms-playwright

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Secrets are passed via stdin JSON and set in Node.js — no env files or temp files on disk
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN printf '#!/bin/bash\nset -e\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace

# Switch to non-root user (required for --dangerously-skip-permissions)
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
