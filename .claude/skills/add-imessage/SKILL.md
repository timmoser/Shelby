---
name: add-imessage
description: Native iMessage channel implementation via direct database access and AppleScript. The core architecture of NanoClaw - implements the Channel interface for clean, extensible messaging.
---

# iMessage Channel (Native Implementation)

> **Status:** ✅ **Already Implemented** - This skill documents the existing iMessage channel architecture.

NanoClaw's **primary messaging channel** - native iMessage support via direct database access and AppleScript. **No BlueBubbles or Private API required** - completely secure and under your control.

**Current Implementation:** `src/channels/imessage.ts` - Full Channel interface implementation with approval workflow and collaboration support.

## Architecture

### Channel Interface Implementation

iMessage is implemented as a proper `Channel` following the NanoClaw channel architecture:

```typescript
export class IMessageChannel implements Channel {
  name = 'imessage';
  prefixAssistantName = false; // iMessage shows as you, not as a bot

  async connect(): Promise<void>;
  async sendMessage(jid: string, text: string): Promise<void>;
  async setTyping(jid: string, isTyping: boolean): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  async disconnect(): Promise<void>;
}
```

### Key Features

- **Reading messages**: Direct SQLite access to `~/Library/Messages/chat.db` (2-second polling)
- **Sending messages**: Native AppleScript via Messages.app
- **No third-party software**: Pure macOS integration
- **No security compromises**: No Private API or SIP disabling required
- **Isolated agents**: Each contact gets their own agent container
- **Approval workflow**: New contacts require approval before chatting
- **Collaboration watching**: Host-level `fswatch` for instant multi-agent coordination (zero CPU when idle)

## Prerequisites

### 1. Full Disk Access Permission

Node.js needs permission to read the Messages database:

1. Open **System Settings** → **Privacy & Security** → **Full Disk Access**
2. Click the 🔒 lock and authenticate
3. Click **+** button
4. Press **⌘⇧G** and enter the path to your Node.js binary:
   - **Apple Silicon (M1/M2/M3)**: `/opt/homebrew/bin/node`
   - **Intel Mac**: `/usr/local/bin/node`
   - **Or find yours**: Run `which node` in terminal
5. Click **Open** and enable the toggle

### 2. Messages.app Running

The Messages app must be running and signed into iMessage for sending to work.

### 3. Install Required Package

```bash
npm install better-sqlite3
```

This provides native SQLite access to the Messages database.

## Questions to Ask

Before implementation, ask:

1. **Auto-registration behavior**: How should new contacts be handled?
   - **Require approval (Recommended)**: New contacts require approval before chatting. Denied contacts are blocked.
   - **Auto-approve all**: Anyone can message immediately (less secure)
   - **Manual registration only**: Chats must be pre-registered

2. **Collaboration folder**: Where should the shared workspace be created?
   - Default: `~/nanoclaw-collaboration/`
   - Custom path: User specifies absolute path
   - This folder allows different agents to collaborate on shared tasks
   - Note: Remember the path you choose - you'll need it in Step 3 and Step 7

3. **Mount allowlist**: Should we add the collaboration folder to the mount allowlist?
   - Default: `~/.config/nanoclaw/mount-allowlist.json`
   - Add with read-write access for all agents

## Implementation

### Step 1: Update Configuration

Read `src/config.ts` and add iMessage config (if not already present):

```typescript
export const IMESSAGE_ONLY = process.env.IMESSAGE_ONLY === 'true';
export const IMESSAGE_COLLABORATION_FOLDER =
  process.env.IMESSAGE_COLLABORATION_FOLDER ||
  path.join(os.homedir(), 'nanoclaw-collaboration');
```

Note: We no longer need `IMESSAGE_SERVER_URL`, `IMESSAGE_PASSWORD`, or `IMESSAGE_WEBHOOK_PORT` since we're using direct database access.

**Optional**: If user chose a custom collaboration folder in the questions, add it to `.env`:

```bash
# In .env file
IMESSAGE_COLLABORATION_FOLDER=/path/to/custom/folder
```

### Step 2: Add Database Tables

Check `src/db.ts` for approval workflow tables. Add if missing:

```typescript
// In initDatabase() function:
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_imessage_approvals (
    chat_jid TEXT PRIMARY KEY,
    contact_info TEXT NOT NULL,
    first_message TEXT,
    requested_at TEXT NOT NULL,
    notified INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS blocked_imessage_contacts (
    chat_jid TEXT PRIMARY KEY,
    contact_info TEXT NOT NULL,
    blocked_at TEXT NOT NULL,
    reason TEXT
  );
`);
```

Add helper functions for managing approvals:

```typescript
export function addPendingApproval(
  chatJid: string,
  contactInfo: string,
  firstMessage: string,
): void {
  db.prepare(
    'INSERT OR REPLACE INTO pending_imessage_approvals (chat_jid, contact_info, first_message, requested_at) VALUES (?, ?, ?, ?)',
  ).run(chatJid, contactInfo, firstMessage, new Date().toISOString());
}

export function getPendingApproval(chatJid: string) {
  return db
    .prepare('SELECT * FROM pending_imessage_approvals WHERE chat_jid = ?')
    .get(chatJid);
}

export function getPendingApprovals() {
  return db.prepare('SELECT * FROM pending_imessage_approvals').all();
}

export function removePendingApproval(chatJid: string): void {
  db.prepare('DELETE FROM pending_imessage_approvals WHERE chat_jid = ?').run(
    chatJid,
  );
}

export function addBlockedContact(
  chatJid: string,
  contactInfo: string,
  reason: string,
): void {
  db.prepare(
    'INSERT OR REPLACE INTO blocked_imessage_contacts (chat_jid, contact_info, blocked_at, reason) VALUES (?, ?, ?, ?)',
  ).run(chatJid, contactInfo, new Date().toISOString(), reason);
}

export function isContactBlocked(chatJid: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM blocked_imessage_contacts WHERE chat_jid = ?')
    .get(chatJid);
  return !!row;
}

export function getBlockedContacts() {
  return db.prepare('SELECT * FROM blocked_imessage_contacts').all();
}
```

### Step 3: Create iMessage Module

Create `src/imessage.ts` with direct database access:

```typescript
import Database from 'better-sqlite3';
import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  MAIN_GROUP_FOLDER,
  TRIGGER_PATTERN,
} from './config.js';
import {
  addPendingApproval,
  getAllRegisteredGroups,
  getPendingApproval,
  isContactBlocked,
  storeChatMetadata,
  storeMessageDirect,
} from './db.js';
import { logger } from './logger.js';

const execPromise = promisify(exec);

let pollingInterval: NodeJS.Timeout | null = null;
let lastProcessedRowId = 0;

const MESSAGES_DB_PATH = path.join(os.homedir(), 'Library/Messages/chat.db');

interface MessageRow {
  ROWID: number;
  guid: string;
  text: string | null;
  sender: string | null;
  chat_identifier: string | null;
  date: number;
  is_from_me: number;
  service: string;
}

function normalizeChatGuid(contactId: string): string {
  return `imsg:${contactId}`;
}

function getNewMessages(): MessageRow[] {
  let db: Database.Database | null = null;
  try {
    db = new Database(MESSAGES_DB_PATH, { readonly: true });

    const query = `
      SELECT
        m.ROWID, m.guid, m.text,
        h.id as sender,
        c.chat_identifier,
        m.date, m.is_from_me, m.service
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE m.service = 'iMessage' AND m.ROWID > ?
      ORDER BY m.ROWID ASC
    `;

    return db.prepare(query).all(lastProcessedRowId) as MessageRow[];
  } catch (err) {
    logger.error(
      { err, lastProcessedRowId },
      'Error querying Messages database',
    );
    return [];
  } finally {
    if (db) db.close();
  }
}

function handleIncomingMessage(message: MessageRow): void {
  lastProcessedRowId = Math.max(lastProcessedRowId, message.ROWID);

  if (message.is_from_me === 1) return;
  if (!message.sender || !message.chat_identifier) return;

  const chatGuid = normalizeChatGuid(message.sender);
  const messageText = message.text || '';
  const timestamp = new Date(message.date / 1000000 + 978307200000);
  const sender = message.sender;

  storeChatMetadata(chatGuid, timestamp.toISOString(), sender);

  if (isContactBlocked(chatGuid)) return;

  const registeredGroups = getAllRegisteredGroups();
  const group = registeredGroups[chatGuid];

  if (!group) {
    const pending = getPendingApproval(chatGuid);
    if (!pending) {
      addPendingApproval(chatGuid, sender, messageText.substring(0, 200));
      notifyPendingApproval(chatGuid, sender, messageText.substring(0, 200));
    }
    return;
  }

  if (!messageText.trim()) return;

  let content = messageText;
  if (!TRIGGER_PATTERN.test(content)) {
    const wasMentioned = content
      .toLowerCase()
      .includes(ASSISTANT_NAME.toLowerCase());
    if (wasMentioned && group.requiresTrigger !== false) {
      content = `@${ASSISTANT_NAME} ${content}`;
    }
  }

  storeMessageDirect({
    id: message.guid,
    chat_jid: chatGuid,
    sender,
    sender_name: sender,
    content,
    timestamp: timestamp.toISOString(),
    is_from_me: false,
  });

  logger.info(
    { chatGuid, sender, rowId: message.ROWID },
    'iMessage stored from database',
  );
}

function notifyPendingApproval(
  chatGuid: string,
  senderName: string,
  firstMessage: string,
): void {
  try {
    const ipcDir = path.join(DATA_DIR, 'ipc', MAIN_GROUP_FOLDER, 'input');
    fs.mkdirSync(ipcDir, { recursive: true });

    const notification = {
      type: 'pending_imessage_approval',
      chat_jid: chatGuid,
      sender_name: senderName,
      first_message: firstMessage,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(ipcDir, `approval-${Date.now()}.json`),
      JSON.stringify(notification, null, 2),
    );
  } catch (err) {
    logger.error({ err, chatGuid }, 'Failed to send approval notification');
  }
}

async function pollMessages(): Promise<void> {
  try {
    const messages = getNewMessages();
    for (const message of messages) {
      handleIncomingMessage(message);
    }
  } catch (err) {
    logger.error({ err }, 'Error polling Messages database');
  }
}

function initializeLastProcessedRowId(): void {
  let db: Database.Database | null = null;
  try {
    db = new Database(MESSAGES_DB_PATH, { readonly: true });
    const result = db
      .prepare('SELECT MAX(ROWID) as maxId FROM message WHERE service = ?')
      .get('iMessage') as { maxId: number | null };
    if (result?.maxId) {
      lastProcessedRowId = result.maxId;
      logger.info(
        { lastProcessedRowId },
        'Initialized with current max message ID',
      );
    }
  } catch (err) {
    logger.error({ err }, 'Error initializing last processed row ID');
  } finally {
    if (db) db.close();
  }
}

export async function connectIMessage(): Promise<void> {
  logger.info('Starting iMessage polling via direct database access');
  initializeLastProcessedRowId();
  pollingInterval = setInterval(pollMessages, 2000);
  logger.info({ interval: '2s' }, 'iMessage database polling started');
}

export async function sendIMessage(
  chatGuid: string,
  text: string,
): Promise<void> {
  try {
    const contactId = chatGuid.replace(/^imsg:/, '');
    const tmpFile = `/tmp/imessage-${Date.now()}.scpt`;
    const escapedText = text
      .replace(/\\\\/g, '\\\\\\\\')
      .replace(/"/g, '\\\\"');
    const escapedContact = contactId
      .replace(/\\\\/g, '\\\\\\\\')
      .replace(/"/g, '\\\\"');

    const script = `tell application "Messages"
  set targetService to 1st account whose service type = iMessage
  set targetBuddy to participant "${escapedContact}" of targetService
  send "${escapedText}" to targetBuddy
end tell`;

    fs.writeFileSync(tmpFile, script, 'utf-8');
    await execPromise(`osascript "${tmpFile}"`);
    fs.unlinkSync(tmpFile);
    logger.info(
      { chatGuid, contactId, length: text.length },
      'iMessage sent via AppleScript',
    );
  } catch (err) {
    logger.error({ chatGuid, err }, 'Error sending iMessage via AppleScript');
  }
}

export async function setIMessageTyping(chatGuid: string): Promise<void> {
  // Typing indicators not supported via AppleScript - no-op
}

export function isIMessageConnected(): boolean {
  return pollingInterval !== null;
}

export function stopIMessage(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  logger.info('iMessage polling stopped');
}

export async function approveIMessageContact(
  chatGuid: string,
  registerGroup: (jid: string, group: any) => void,
  useMainAgent = false,
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      getAllRegisteredGroups,
      getPendingApproval,
      removePendingApproval,
    } = await import('./db.js');
    const { MAIN_GROUP_FOLDER } = await import('./config.js');

    const pending = getPendingApproval(chatGuid);
    if (!pending) return { success: false, error: 'No pending approval found' };

    const registeredGroups = getAllRegisteredGroups();
    if (registeredGroups[chatGuid])
      return { success: false, error: 'Already registered' };

    let folderName: string;
    if (useMainAgent) {
      folderName = MAIN_GROUP_FOLDER;
    } else {
      const sanitizedName = pending.contact_info
        .replace(/[^a-zA-Z0-9-]/g, '-')
        .toLowerCase();
      folderName = `imessage-${sanitizedName}-${Date.now()}`;
    }

    // Get collaboration folder from environment or use default
    const collaborationFolder =
      process.env.IMESSAGE_COLLABORATION_FOLDER ||
      path.join(os.homedir(), 'nanoclaw-collaboration');

    registerGroup(chatGuid, {
      name: pending.contact_info,
      folder: folderName,
      trigger: `@${ASSISTANT_NAME}`,
      added_at: new Date().toISOString(),
      requiresTrigger: false,
      containerConfig: useMainAgent
        ? undefined
        : {
            additionalMounts: [
              {
                hostPath: collaborationFolder,
                containerPath: 'collaboration',
                readonly: false,
              },
            ],
          },
    });

    removePendingApproval(chatGuid);
    const mode = useMainAgent ? 'main agent' : 'isolated agent';
    logger.info(
      { chatGuid, folder: folderName, contact: pending.contact_info, mode },
      'iMessage contact approved and registered',
    );
    return { success: true };
  } catch (err) {
    logger.error({ err, chatGuid }, 'Failed to approve contact');
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export async function denyIMessageContact(
  chatGuid: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { addBlockedContact, getPendingApproval, removePendingApproval } =
      await import('./db.js');

    const pending = getPendingApproval(chatGuid);
    if (!pending) return { success: false, error: 'No pending approval found' };

    addBlockedContact(
      chatGuid,
      pending.contact_info,
      reason || 'Denied by user',
    );
    removePendingApproval(chatGuid);

    logger.info(
      { chatGuid, contact: pending.contact_info, reason },
      'iMessage contact denied and blocked',
    );
    return { success: true };
  } catch (err) {
    logger.error({ err, chatGuid }, 'Failed to deny contact');
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
```

### Step 4: Update Main Application

Modify `src/index.ts`:

1. **Add imports**:

```typescript
import {
  connectIMessage,
  sendIMessage,
  setIMessageTyping,
  stopIMessage,
  approveIMessageContact,
  denyIMessageContact,
} from './imessage.js';
import { IMESSAGE_ONLY } from './config.js';
```

2. **Update sendMessage function** to route iMessage:

```typescript
async function sendMessage(jid: string, text: string): Promise<void> {
  if (jid.startsWith('imsg:')) {
    await sendIMessage(jid, text);
    return;
  }
  // ... rest of function
}
```

3. **Update setTyping function**:

```typescript
async function setTyping(jid: string, isTyping: boolean): Promise<void> {
  if (jid.startsWith('imsg:')) {
    if (isTyping) await setIMessageTyping(jid);
    return;
  }
  // ... rest of function
}
```

4. **Add `deliverToActiveContainer()` function** (IPC delivery for follow-up messages):

The upstream WhatsApp codebase uses `startMessageLoop()` which polls for messages and tries `queue.sendMessage()` before falling back to `queue.enqueueMessageCheck()`. Since iMessage uses an event-driven `onMessage` callback instead of a polling loop, we need an equivalent function that attempts IPC delivery to an active container:

```typescript
/**
 * Try to deliver pending messages to an already-running container via IPC.
 * Matches the upstream startMessageLoop pattern: try queue.sendMessage() first,
 * return true if delivered, false if no active container.
 */
function deliverToActiveContainer(chatJid: string): boolean {
  const group = registeredGroups[chatJid];
  if (!group) return false;

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return false;

  // For non-main groups, check trigger requirement
  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return false;
  }

  const prompt = formatMessages(missedMessages);
  const delivered = queue.sendMessage(chatJid, prompt);

  if (delivered) {
    // Advance cursor so these messages aren't re-processed
    lastAgentTimestamp[chatJid] =
      missedMessages[missedMessages.length - 1].timestamp;
    saveState();
    logger.info(
      { group: group.name, messageCount: missedMessages.length },
      'Delivered messages to active container via IPC',
    );
    // Reset idle timer so the container stays alive for the follow-up
    const timer = activeIdleTimers.get(chatJid);
    if (timer) {
      timer.reset();
    }
    // Send a "thinking..." indicator so the user knows the bot received their message
    sendMessage(chatJid, 'thinking...').catch(() => {});
  }

  return delivered;
}
```

Also add a module-level `activeIdleTimers` map and register idle timers in `processGroupMessages`:

```typescript
const activeIdleTimers = new Map<
  string,
  { reset: () => void; clear: () => void }
>();
```

In `processGroupMessages`, after creating the idle timer, register it:

```typescript
activeIdleTimers.set(chatJid, {
  reset: resetIdleTimer,
  clear: () => {
    if (idleTimer) clearTimeout(idleTimer);
  },
});
```

And clean up when done: `activeIdleTimers.delete(chatJid);`

5. **Update main() function**:

```typescript
async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  loadState();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    stopIMessage();
    stopTelegram();
    await queue.shutdown(10000);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start iMessage (native, no BlueBubbles required)
  await connectIMessage();

  // Start Telegram if configured
  const hasTelegram = !!TELEGRAM_BOT_TOKEN;
  if (hasTelegram) {
    await connectTelegram(TELEGRAM_BOT_TOKEN);
  }

  if (!TELEGRAM_ONLY && !IMESSAGE_ONLY) {
    await connectWhatsApp();
  } else {
    // Start services without WhatsApp
    startSchedulerLoop(...);
    startIpcWatcher();
    queue.setProcessMessagesFn(processGroupMessages);
    recoverPendingMessages();
    startMessageLoop();

    const channels = ['iMessage'];
    if (hasTelegram) channels.push('Telegram');
    logger.info(`NanoClaw running (${channels.join(' + ')}, trigger: @${ASSISTANT_NAME})`);
  }
}
```

**IMPORTANT**: In the `onMessage` callback for iMessage, match the upstream `startMessageLoop` pattern by trying IPC delivery first:

```typescript
onMessage: (chatJid, msg) => {
  // Match upstream startMessageLoop pattern: try IPC delivery first,
  // fall back to enqueueMessageCheck if no active container
  if (deliverToActiveContainer(chatJid)) {
    return;
  }
  queue.enqueueMessageCheck(chatJid);
},
```

This is critical — without it, follow-up messages while a container is running won't be delivered until the container exits. The upstream WhatsApp codebase handles this in `startMessageLoop()` but iMessage's event-driven callback needs it explicitly.

6. **Add IPC handlers** for approval workflow (in the IPC switch statement):

```typescript
case 'approve_imessage_contact':
  if (!isMain) {
    logger.warn({ sourceGroup }, 'Unauthorized approve_imessage_contact blocked');
    break;
  }
  if (data.chatJid) {
    const useMainAgent = (data as any).useMainAgent === true;
    approveIMessageContact(data.chatJid, registerGroup, useMainAgent)
      .then((result) => {
        if (result.success) {
          const mode = useMainAgent ? 'main agent' : 'isolated agent';
          logger.info({ chatJid: data.chatJid, mode }, 'iMessage contact approved');
        } else {
          logger.error({ chatJid: data.chatJid, error: result.error }, 'Failed to approve');
        }
      });
  }
  break;

case 'deny_imessage_contact':
  if (!isMain) {
    logger.warn({ sourceGroup }, 'Unauthorized deny_imessage_contact blocked');
    break;
  }
  if (data.chatJid) {
    denyIMessageContact(data.chatJid, (data as any).reason)
      .then((result) => {
        if (result.success) {
          logger.info({ chatJid: data.chatJid }, 'iMessage contact denied');
        } else {
          logger.error({ chatJid: data.chatJid, error: result.error }, 'Failed to deny');
        }
      });
  }
  break;
```

7. **Update getAvailableGroups**:

```typescript
.filter((c) => c.jid !== '__group_sync__' && (c.jid.endsWith('@g.us') || c.jid.startsWith('tg:') || c.jid.startsWith('imsg:')))
```

### Step 6: Create Collaboration Folder

Use the path chosen in the questions (default: `~/nanoclaw-collaboration`):

```bash
# Replace with your chosen path if custom
mkdir -p ~/nanoclaw-collaboration
```

Create a README explaining the folder:

```bash
# Replace ~/nanoclaw-collaboration with your chosen path if custom
cat > ~/nanoclaw-collaboration/README.md << 'EOF'
# NanoClaw Collaboration Workspace

This folder is shared across all approved iMessage agents for collaborative work.

Each iMessage contact gets their own isolated agent, but this folder allows them to coordinate on shared tasks.
EOF
```

### Step 7: Update Mount Allowlist

Edit `~/.config/nanoclaw/mount-allowlist.json`. Add the collaboration folder with the absolute path (use the path from your questions, e.g., if you chose `~/nanoclaw-collaboration`, expand it to `/Users/yourname/nanoclaw-collaboration`):

```json
{
  "allowedRoots": [
    {
      "path": "/Users/yourname/nanoclaw-collaboration",
      "allowReadWrite": true,
      "description": "Shared collaboration workspace for iMessage agents"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": false
}
```

**Note**: Replace `/Users/yourname/nanoclaw-collaboration` with your actual absolute path. Run `echo ~/nanoclaw-collaboration` to get it.

### Step 8: Build and Restart

```bash
npm run build
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

### Step 9: Test and Approve Contacts

1. **Send a test iMessage** to yourself from another device
2. **Check logs** for pending approval notification:
   ```bash
   tail -f ~/nanoclaw/logs/nanoclaw.log
   ```
3. **Approve the contact** via IPC (replace `contact@email.com` with the actual sender):

```bash
cat > ~/nanoclaw/data/ipc/main/tasks/approve-contact.json << EOF
{
  "type": "approve_imessage_contact",
  "chatJid": "imsg:contact@email.com"
}
EOF
```

Or to use your main agent instead of isolated:

```bash
cat > ~/nanoclaw/data/ipc/main/tasks/approve-contact.json << EOF
{
  "type": "approve_imessage_contact",
  "chatJid": "imsg:contact@email.com",
  "useMainAgent": true
}
EOF
```

4. **Send another message** - Your assistant should respond!

## Features

### Architecture Highlights

- **Direct database access**: Reads from `~/Library/Messages/chat.db` every 2 seconds
- **AppleScript sending**: Uses native macOS Messages.app automation
- **No third-party dependencies**: Completely self-contained
- **Isolated agents**: Each contact gets their own container with separate memory
- **Approval workflow**: New contacts must be approved before chatting
- **Collaboration folder**: Approved agents can share files for joint tasks
- **Persistent registrations**: Contacts stay registered across restarts
- **Instant file notifications**: Host-level file watching wakes sleeping agents automatically

### Host-Level Collaboration File Watching

NanoClaw monitors collaboration folders on the **host system** (outside containers) and automatically wakes agents when files change. This enables true multi-agent collaboration where agents can work together on shared tasks.

**How it works:**

- **Host watcher**: Runs on your Mac using `fswatch` (or `inotifywait` on Linux)
- **Monitors**: `~/nanoclaw-collaboration/` and `~/Library/Mobile Documents/com~apple~CloudDocs/Shelby/`
- **Instant wake-up**: When files change, finds all agents with those folders mounted
- **Starts containers**: Spawns agent containers with file change notification
- **Zero CPU idle**: Uses kernel-level notifications (no polling)

**Installation (macOS):**

```bash
brew install fswatch
```

**What happens when a file changes:**

1. You drop `task.md` in `~/nanoclaw-collaboration/`
2. Host watcher detects change via `fswatch` (~0.5s latency)
3. Finds agents with collaboration folder mounted (e.g., main + Dawn's agent)
4. Starts **both agent containers** simultaneously
5. Each agent receives IPC notification: `[File changed in collaboration folder: task.md]`
6. Agents can read the file at `/workspace/collaboration/task.md` and respond
7. Agents stay alive 5 minutes for follow-up collaboration

**Example collaboration workflow:**

1. **Your agent** creates `/workspace/collaboration/research-findings.md`
2. **Host watcher** detects the new file on your Mac
3. **Dawn's agent** automatically wakes up and receives notification
4. **Dawn's agent** reads the file, processes it, and sends results to Dawn via iMessage
5. **Dawn responds** with feedback
6. **Dawn's agent** updates `/workspace/collaboration/research-findings.md` with her notes
7. **Your agent** wakes up automatically and sees Dawn's updates
8. **Real-time collaboration** without manual polling or waiting

**Benefits:**

- **True async collaboration**: Agents work together across time zones
- **No polling overhead**: Zero CPU when idle, instant wake on changes
- **Bidirectional**: Both agents notify each other automatically
- **Persistent workspace**: Shared files survive agent restarts
- **iCloud integration**: Also monitors iCloud shared folders for external collaboration

**Inside containers (automatic):**

- Container-level `FileWatcher` monitors `/workspace/ipc/input`, `/workspace/collaboration`, `/workspace/icloud`, `/workspace/group`
- Uses `inotifywait` (Linux) for instant notifications while agent is running
- Filters out temporary files (`.tmp`, `~`, `.hidden`)
- Zero CPU when idle, instant response when files change

### Chat GUID Format

- **iMessage**: `imsg:contact@email.com` or `imsg:+15551234567`
- **WhatsApp**: `1234567890@s.whatsapp.net` or `120363336345536173@g.us`
- **Telegram**: `tg:123456789` or `tg:-1001234567890`

### Privacy Model

- Each iMessage contact has a **completely isolated agent**
- Separate conversation history and memory
- Cannot see other conversations
- Only shared space is the collaboration folder (optional)
- Same model as WhatsApp groups

## Approval Workflow

When a new contact messages:

1. Message is detected but not processed
2. IPC notification sent to main user's input folder
3. **Ask user**: Should this contact use your main agent or get an isolated agent?
   - **Isolated agent (Recommended)**: Contact gets their own container with separate memory
   - **Main agent**: Contact shares your main agent's memory and conversation history (less privacy)
4. Main user approves or denies via IPC task
5. If approved with isolated agent: Contact is registered with new workspace folder
6. If approved with main agent: Contact is registered to use `MAIN_GROUP_FOLDER`
7. If denied: Contact is blocked and future messages ignored

**Approve command (isolated agent):**

```json
{
  "type": "approve_imessage_contact",
  "chatJid": "imsg:contact@email.com"
}
```

**Approve command (main agent):**

```json
{
  "type": "approve_imessage_contact",
  "chatJid": "imsg:contact@email.com",
  "useMainAgent": true
}
```

**Deny command:**

```json
{
  "type": "deny_imessage_contact",
  "chatJid": "imsg:contact@email.com",
  "reason": "Spam"
}
```

## Troubleshooting

### File watching not working

**Symptoms:** Agents don't wake up when files are added to collaboration folder

**Check if fswatch is installed (macOS):**

```bash
which fswatch
# Should output: /opt/homebrew/bin/fswatch
```

**Install fswatch:**

```bash
brew install fswatch
# Restart NanoClaw:
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

**Verify watcher started:**

```bash
grep "Collaboration.*watcher" ~/nanoclaw/logs/nanoclaw.log | tail -3
# Should see: "Collaboration watcher started (fswatch)"
```

**Test file watching:**

```bash
echo "test" > ~/nanoclaw-collaboration/test.txt
# Check logs for trigger:
grep "Triggering agents" ~/nanoclaw/logs/nanoclaw.log | tail -1
# Should see: "Triggering agents for collaboration folder change"
```

### No messages detected

1. Check Full Disk Access is granted to your Node.js binary (find it with `which node`)
2. Verify Messages.app is running and signed into iMessage
3. Check logs: `tail -f ~/nanoclaw/logs/nanoclaw.log`
4. Test database access: `sqlite3 ~/Library/Messages/chat.db "SELECT COUNT(*) FROM message WHERE service='iMessage';"`

### Messages not sending

1. Verify Messages.app is running
2. Check you're signed into iMessage
3. Test AppleScript manually:

```bash
osascript -e 'tell application "Messages" to get version'
```

4. Check error logs for AppleScript failures

### Database permission errors

Re-grant Full Disk Access:

1. Remove your Node.js binary from Full Disk Access list (find with `which node`)
2. Add it back
3. Restart NanoClaw service

### Contacts not persisting

Registrations are stored in `~/nanoclaw/store/messages.db` (relative to your project root). Verify:

```bash
sqlite3 ~/nanoclaw/store/messages.db "SELECT jid, name FROM registered_groups WHERE jid LIKE 'imsg:%';"
```

## Security Notes

- ✅ No Private API or SIP disabling required
- ✅ Direct database access (read-only)
- ✅ Native AppleScript (standard macOS automation)
- ✅ Approval workflow prevents spam
- ✅ Isolated agent containers for privacy
- ✅ Collaboration folder is opt-in per contact

## Replace WhatsApp Entirely

To use only iMessage:

```bash
# In .env
IMESSAGE_ONLY=true
```

This skips WhatsApp connection entirely. All services start independently.

## Multi-Channel Setup

Run all three channels simultaneously:

```bash
# In .env
TELEGRAM_BOT_TOKEN=your_token
# IMESSAGE_ONLY and TELEGRAM_ONLY both unset
```

All channels poll and respond independently.

## Removal

1. Delete `src/imessage.ts`
2. Remove imports from `src/index.ts`
3. Remove routing from `sendMessage()` and `setTyping()`
4. Remove `connectIMessage()` from `main()`
5. Remove approval IPC handlers
6. Remove database tables
7. Uninstall: `npm uninstall better-sqlite3`
8. Rebuild and restart
