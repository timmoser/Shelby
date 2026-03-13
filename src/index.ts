import { ChildProcess, execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  CREDENTIAL_PROXY_PORT,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  TIMEZONE,
  TRIGGER_PATTERN,
} from './config.js';
import {
  ensureContainerRuntimeRunning,
  cleanupOrphans,
} from './container-runtime.js';
import { startCredentialProxy } from './credential-proxy.js';
import {
  IMessageChannel,
  approveIMessageContact as approveIMessageContactHelper,
  denyIMessageContact as denyIMessageContactHelper,
} from './channels/imessage.js';
import { CollaborationWatcher } from './collaboration-watcher.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getBlockedContacts,
  getMessagesSince,
  getPendingApprovals,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { formatMessages } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { initializeAllHeartbeats } from './heartbeat-scheduler.js';

// Re-export for backwards compatibility
export { escapeXml, formatMessages } from './router.js';

let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
const activeIdleTimers = new Map<
  string,
  { reset: () => void; clear: () => void }
>();

let imessage: IMessageChannel;
const queue = new GroupQueue();

function loadState(): void {
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@g.us'))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages, TIMEZONE);

  // Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  // Register idle timer so follow-up messages can reset it
  activeIdleTimers.set(chatJid, {
    reset: resetIdleTimer,
    clear: () => {
      if (idleTimer) clearTimeout(idleTimer);
    },
  });

  await setTyping(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(
    group,
    prompt,
    chatJid,
    'claude-opus-4-6',
    async (result) => {
      // Streaming output callback — called for each agent result
      if (result.result) {
        const raw =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);
        // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        logger.info(
          { group: group.name },
          `Agent output: ${raw.slice(0, 200)}`,
        );
        if (text) {
          await sendMessage(chatJid, text);
          outputSentToUser = true;
        }
        // Only reset idle timer on actual results, not session-update markers (result: null)
        resetIdleTimer();
      }

      if (result.status === 'error') {
        hadError = true;
      }
    },
  );

  await setTyping(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);
  activeIdleTimers.delete(chatJid);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    return false;
  }

  return true;
}

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

  const prompt = formatMessages(missedMessages, TIMEZONE);
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
      logger.debug({ chatJid }, 'Idle timer reset due to new user message');
    }
    // Send a "thinking..." indicator so the user knows the bot received their message
    sendMessage(chatJid, 'thinking...').catch(() => {});
  }

  return delivered;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  model: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        model,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function sendMessage(jid: string, text: string): Promise<void> {
  await imessage.sendMessage(jid, text);
}

async function setTyping(jid: string, isTyping: boolean): Promise<void> {
  await imessage.setTyping(jid, isTyping);
}

// ensureContainerSystemRunning and cleanupOrphans are imported from container-runtime.ts

// Pencil MCP HTTP server process (spawned on host for container access)
const PENCIL_MCP_BINARY =
  '/Applications/Pencil.app/Contents/Resources/app.asar.unpacked/out/mcp-server-darwin-arm64';
const PENCIL_MCP_PORT = 8222;
let pencilMcpProcess: ChildProcess | null = null;

function startPencilMcpServer(): void {
  if (!fs.existsSync(PENCIL_MCP_BINARY)) {
    logger.debug('Pencil app not installed, skipping MCP server');
    return;
  }
  try {
    pencilMcpProcess = spawn(
      PENCIL_MCP_BINARY,
      ['--app', 'desktop', '--http', '--http-port', String(PENCIL_MCP_PORT)],
      { stdio: 'ignore', detached: false },
    );
    pencilMcpProcess.on('error', (err) => {
      logger.warn({ err }, 'Pencil MCP server failed to start');
      pencilMcpProcess = null;
    });
    pencilMcpProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        logger.warn({ code }, 'Pencil MCP server exited unexpectedly');
      }
      pencilMcpProcess = null;
    });
    logger.info({ port: PENCIL_MCP_PORT }, 'Pencil MCP HTTP server started');
  } catch (err) {
    logger.warn({ err }, 'Failed to spawn Pencil MCP server');
  }
}

async function main(): Promise<void> {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
  await startCredentialProxy(CREDENTIAL_PROXY_PORT);
  startPencilMcpServer();

  // Cache GitHub token for container agents (GitHub MCP proxy)
  if (!process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    try {
      const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 5000 }).trim();
      if (token) {
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN = token;
        logger.info('GitHub token cached from gh CLI');
      }
    } catch {
      logger.debug('GitHub CLI not available, GitHub MCP will be disabled in containers');
    }
  }

  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    if (pencilMcpProcess) {
      pencilMcpProcess.kill();
      pencilMcpProcess = null;
    }
    await queue.shutdown(10000);
    await imessage.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM').catch(() => process.exit(1)));
  process.on('SIGINT', () => shutdown('SIGINT').catch(() => process.exit(1)));

  // Create iMessage channel
  imessage = new IMessageChannel({
    onMessage: (chatJid, msg) => {
      // Match upstream startMessageLoop pattern: try IPC delivery first,
      // fall back to enqueueMessageCheck if no active container
      if (deliverToActiveContainer(chatJid)) {
        return;
      }
      queue.enqueueMessageCheck(chatJid);
    },
    onApprovalRequest: async (chatJid, contactInfo, firstMessage) => {
      logger.info(
        { chatJid, contactInfo },
        'New iMessage contact pending approval',
      );
      // Notify main agent about pending approval
      const mainJid = Object.keys(registeredGroups).find(
        (jid) => registeredGroups[jid].folder === MAIN_GROUP_FOLDER,
      );
      if (mainJid) {
        const pendingApprovals = getPendingApprovals();
        const blockedContacts = getBlockedContacts();
        const summary = `📱 iMessage Contact Approvals Needed:\n\nPending:\n${pendingApprovals.map((a) => `- ${a.contact_info}: ${a.first_message || '(no message)'}`).join('\n')}\n\nBlocked:\n${blockedContacts.map((b) => `- ${b.contact_info}: ${b.reason || 'no reason'}`).join('\n')}`;
        await sendMessage(mainJid, summary);
      }
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
  });

  // Connect — starts polling
  await imessage.connect();

  // Start collaboration folder watcher
  function startCollaborationWatcher(): void {
    const watcher = new CollaborationWatcher();

    watcher.on('change', (event: { path: string; event: string }) => {
      // Find groups that have this folder mounted
      const affectedGroups: string[] = [];
      for (const [jid, group] of Object.entries(registeredGroups)) {
        if (!group.containerConfig?.additionalMounts) continue;
        for (const mount of group.containerConfig.additionalMounts) {
          const expandedPath = mount.hostPath.replace(
            '~',
            process.env.HOME || '',
          );
          if (event.path.startsWith(expandedPath)) {
            affectedGroups.push(jid);
            break;
          }
        }
      }

      // Trigger each affected group
      for (const jid of affectedGroups) {
        const group = registeredGroups[jid];
        logger.info(
          { group: group.name, file: path.basename(event.path) },
          'Collaboration file changed',
        );
        queue.enqueueTask(jid, `collab-file-${Date.now()}`, async () => {
          const prompt = `[A file was modified in your collaboration folder: ${path.basename(event.path)}]`;
          await runAgent(
            group,
            prompt,
            jid,
            'claude-opus-4-6',
            async (result) => {
              if (result.result) {
                const raw =
                  typeof result.result === 'string'
                    ? result.result
                    : JSON.stringify(result.result);
                const text = raw
                  .replace(/<internal>[\s\S]*?<\/internal>/g, '')
                  .trim();
                if (text) await sendMessage(jid, text);
              }
            },
          );
        });
      }
    });

    watcher.start();
  }

  startCollaborationWatcher();

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage,
    registerIdleTimer: (chatJid, timer) => activeIdleTimers.set(chatJid, timer),
    unregisterIdleTimer: (chatJid) => activeIdleTimers.delete(chatJid),
  });

  // Initialize heartbeats for groups that have heartbeat-config.json
  initializeAllHeartbeats(registeredGroups);

  startIpcWatcher({
    sendMessage,
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: async () => {
      // No-op for iMessage - no group metadata sync needed
    },
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) =>
      writeGroupsSnapshot(gf, im, ag, rj),
  });
  queue.setProcessMessagesFn(processGroupMessages);

  logger.info(`NanoClaw running (iMessage, trigger: @${ASSISTANT_NAME})`);
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
