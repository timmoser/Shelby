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
  IMESSAGE_COLLABORATION_FOLDER,
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
let messagesDb: Database.Database | null = null;

const MESSAGES_DB_PATH = path.join(
  os.homedir(),
  'Library/Messages/chat.db',
);

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

/** Normalize chat GUID to consistent format: imsg:{contactId} */
function normalizeChatGuid(contactId: string): string {
  return `imsg:${contactId}`;
}

/**
 * Open the Messages database (read-only)
 */
function openMessagesDatabase(): Database.Database {
  if (messagesDb) return messagesDb;

  try {
    messagesDb = new Database(MESSAGES_DB_PATH, { readonly: true });
    logger.info({ path: MESSAGES_DB_PATH }, 'Opened Messages database');
    return messagesDb;
  } catch (err) {
    logger.error({ err, path: MESSAGES_DB_PATH }, 'Failed to open Messages database');
    throw err;
  }
}

/**
 * Get new messages from Messages database
 */
function getNewMessages(): MessageRow[] {
  let db: Database.Database | null = null;
  try {
    logger.info({ lastProcessedRowId }, 'Querying for new messages');

    // Open fresh connection each time to avoid lock issues
    db = new Database(MESSAGES_DB_PATH, { readonly: true });
    logger.info('Database opened successfully');

    const query = `
      SELECT
        m.ROWID,
        m.guid,
        m.text,
        h.id as sender,
        c.chat_identifier,
        m.date,
        m.is_from_me,
        m.service
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE m.service = 'iMessage'
        AND m.ROWID > ?
      ORDER BY m.ROWID ASC
    `;

    const stmt = db.prepare(query);
    const messages = stmt.all(lastProcessedRowId) as MessageRow[];

    logger.info({ count: messages.length, lastProcessedRowId }, 'Query completed');

    return messages;
  } catch (err) {
    logger.error({ err, lastProcessedRowId }, 'Error querying Messages database');
    return [];
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}

/**
 * Process a message from Messages database
 */
function handleIncomingMessage(message: MessageRow): void {
  logger.info({ rowId: message.ROWID, sender: message.sender, text: message.text?.substring(0, 50) }, 'handleIncomingMessage called');

  // Update last processed ID
  lastProcessedRowId = Math.max(lastProcessedRowId, message.ROWID);

  // Skip messages from the bot itself
  if (message.is_from_me === 1) {
    logger.info({ rowId: message.ROWID }, 'Skipping message from self');
    return;
  }

  // Skip if no sender or chat
  if (!message.sender || !message.chat_identifier) {
    logger.info({ rowId: message.ROWID, sender: message.sender, chat: message.chat_identifier }, 'Skipping - no sender or chat');
    return;
  }

  const chatGuid = normalizeChatGuid(message.sender);
  const messageText = message.text || '';
  // Convert Apple's date format (nanoseconds since 2001-01-01) to JavaScript Date
  const timestamp = new Date(message.date / 1000000 + 978307200000);
  const sender = message.sender;
  const senderName = sender;

  logger.info({ chatGuid, messageText }, 'Processing message');

  // Store chat metadata for discovery
  storeChatMetadata(chatGuid, timestamp.toISOString(), sender);

  // Check if contact is blocked
  if (isContactBlocked(chatGuid)) {
    logger.info({ chatGuid, sender }, 'Skipping - contact is blocked');
    return;
  }

  // Check if this chat is registered
  const registeredGroups = getAllRegisteredGroups();
  const group = registeredGroups[chatGuid];

  logger.info({ chatGuid, isRegistered: !!group }, 'Checked registration');

  if (!group) {
    // Not registered - check if pending approval
    const pending = getPendingApproval(chatGuid);

    if (!pending) {
      // New contact - add to pending approvals
      logger.info(
        { chatGuid, sender: senderName },
        'New iMessage contact detected, requesting approval',
      );

      addPendingApproval(
        chatGuid,
        senderName || sender,
        messageText.substring(0, 200), // Store first 200 chars of message
      );

      // Notify main user about pending approval (via IPC file)
      notifyPendingApproval(chatGuid, senderName, messageText.substring(0, 200));
    } else {
      logger.debug(
        { chatGuid, sender },
        'Message from pending approval contact',
      );
    }

    return;
  }

  // Skip empty messages
  if (!messageText || messageText.trim() === '') {
    return;
  }

  // Apply trigger pattern transformation if needed
  let content = messageText;

  // Check if message already has trigger pattern
  if (!TRIGGER_PATTERN.test(content)) {
    // For group chats, check if assistant was mentioned
    const wasMentioned = content.toLowerCase().includes(ASSISTANT_NAME.toLowerCase());
    if (wasMentioned && group.requiresTrigger !== false) {
      content = `@${ASSISTANT_NAME} ${content}`;
    }
  }

  // Store message — startMessageLoop() will pick it up
  storeMessageDirect({
    id: message.guid,
    chat_jid: chatGuid,
    sender,
    sender_name: senderName,
    content,
    timestamp: timestamp.toISOString(),
    is_from_me: false,
  });

  logger.info(
    { chatGuid, sender: senderName, rowId: message.ROWID },
    'iMessage stored from database',
  );
}

/**
 * Notify main user about pending approval by sending them a message
 */
function notifyPendingApproval(
  chatGuid: string,
  senderName: string,
  firstMessage: string,
): void {
  try {
    // Find the main user's chat (the one using MAIN_GROUP_FOLDER)
    const registeredGroups = getAllRegisteredGroups();
    const mainUserChat = Object.entries(registeredGroups).find(
      ([_, group]: [string, any]) => group.folder === MAIN_GROUP_FOLDER
    );

    if (!mainUserChat) {
      logger.warn('No main user chat found to send approval notification');
      return;
    }

    const [mainUserJid] = mainUserChat;
    const previewText = firstMessage.length > 50
      ? `${firstMessage.substring(0, 50)}...`
      : firstMessage;

    const notificationText = `📬 New iMessage contact pending approval:\n\n` +
      `Contact: ${senderName}\n` +
      `Chat ID: ${chatGuid}\n` +
      `First message: "${previewText}"\n\n` +
      `To approve (isolated agent):\n` +
      `{"type": "approve_imessage_contact", "chatJid": "${chatGuid}"}\n\n` +
      `To approve (main agent):\n` +
      `{"type": "approve_imessage_contact", "chatJid": "${chatGuid}", "useMainAgent": true}\n\n` +
      `To deny:\n` +
      `{"type": "deny_imessage_contact", "chatJid": "${chatGuid}", "reason": "Spam"}`;

    // Store as a message that will be picked up by the message loop
    storeMessageDirect({
      id: `approval-notification-${Date.now()}`,
      chat_jid: mainUserJid,
      sender: 'System',
      sender_name: 'NanoClaw System',
      content: `@${ASSISTANT_NAME} ${notificationText}`,
      timestamp: new Date().toISOString(),
      is_from_me: false,
    });

    logger.info(
      { chatGuid, senderName, mainUserJid },
      'Approval notification sent to main user',
    );
  } catch (err) {
    logger.error({ err, chatGuid }, 'Failed to send approval notification');
  }
}

/**
 * Poll Messages database for new messages
 */
async function pollMessages(): Promise<void> {
  try {
    const messages = getNewMessages();

    if (messages.length > 0) {
      logger.info({ count: messages.length }, 'Processing new messages');
    }

    for (const message of messages) {
      handleIncomingMessage(message);
    }
  } catch (err) {
    logger.error({ err }, 'Error in pollMessages');
  }
}

/**
 * Initialize last processed row ID from database
 */
function initializeLastProcessedRowId(): void {
  let db: Database.Database | null = null;
  try {
    db = new Database(MESSAGES_DB_PATH, { readonly: true });
    const result = db.prepare('SELECT MAX(ROWID) as maxId FROM message WHERE service = \'iMessage\'').get() as { maxId: number | null };

    if (result && result.maxId) {
      // Start from current max - we'll only process new messages from now on
      lastProcessedRowId = result.maxId;
      logger.info({ lastProcessedRowId }, 'Initialized with current max message ID');
    }
  } catch (err) {
    logger.error({ err }, 'Error initializing last processed row ID');
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}

/**
 * Start polling Messages database for new messages
 */
export async function connectIMessage(): Promise<void> {
  logger.info('Starting iMessage polling via direct database access');

  // Initialize the starting point
  initializeLastProcessedRowId();

  // Poll every 2 seconds
  pollingInterval = setInterval(() => {
    pollMessages();
  }, 2000);

  logger.info({ interval: '2s' }, 'iMessage database polling started');
}

export async function sendIMessage(
  chatGuid: string,
  text: string,
): Promise<void> {
  try {
    // Extract contact identifier from GUID
    // Format: imsg:timmoser@me.com or imsg:+1234567890
    const contactId = chatGuid.replace(/^imsg:/, '');

    // Use temporary file to avoid shell escaping issues
    const tmpFile = `/tmp/imessage-${Date.now()}.scpt`;

    // Escape backslashes and quotes for AppleScript
    const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedContact = contactId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const script = `tell application "Messages"
  set targetService to 1st account whose service type = iMessage
  set targetBuddy to participant "${escapedContact}" of targetService
  send "${escapedText}" to targetBuddy
end tell`;

    fs.writeFileSync(tmpFile, script, 'utf-8');

    try {
      await execPromise(`osascript "${tmpFile}"`);
      logger.info({ chatGuid, contactId, length: text.length }, 'iMessage sent via AppleScript');
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    }
  } catch (err) {
    logger.error({ chatGuid, err }, 'Error sending iMessage via AppleScript');
  }
}

export async function setIMessageTyping(chatGuid: string): Promise<void> {
  // Typing indicators not supported via AppleScript
  // This is a no-op to maintain API compatibility
}

export function isIMessageConnected(): boolean {
  return pollingInterval !== null;
}

export function stopIMessage(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  if (messagesDb) {
    messagesDb.close();
    messagesDb = null;
  }
  logger.info('iMessage polling stopped');
}

/**
 * Approve a pending iMessage contact and auto-register them
 */
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

    const pending = getPendingApproval(chatGuid);
    if (!pending) {
      return { success: false, error: 'No pending approval found' };
    }

    // Check if already registered
    const registeredGroups = getAllRegisteredGroups();
    if (registeredGroups[chatGuid]) {
      return { success: false, error: 'Contact is already registered' };
    }

    // Determine folder name based on useMainAgent flag
    let folderName: string;
    if (useMainAgent) {
      folderName = MAIN_GROUP_FOLDER;
    } else {
      // Auto-register with isolated workspace and collaboration folder
      const sanitizedName = pending.contact_info
        .replace(/[^a-zA-Z0-9-]/g, '-')
        .toLowerCase();
      folderName = `imessage-${sanitizedName}-${Date.now()}`;
    }

    const group = {
      name: pending.contact_info,
      folder: folderName,
      trigger: `@${ASSISTANT_NAME}`,
      added_at: new Date().toISOString(),
      requiresTrigger: false, // Auto-respond to approved contacts
      containerConfig: useMainAgent ? undefined : {
        additionalMounts: [
          {
            hostPath: IMESSAGE_COLLABORATION_FOLDER,
            containerPath: 'collaboration',
            readonly: false,
          },
        ],
      },
    };

    registerGroup(chatGuid, group);
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

/**
 * Deny a pending iMessage contact and block them
 */
export async function denyIMessageContact(
  chatGuid: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      addBlockedContact,
      getPendingApproval,
      removePendingApproval,
    } = await import('./db.js');

    const pending = getPendingApproval(chatGuid);
    if (!pending) {
      return { success: false, error: 'No pending approval found' };
    }

    // Add to blocked list
    addBlockedContact(chatGuid, pending.contact_info, reason || 'Denied by user');
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

// Export helper functions for listing approvals/blocks
export { getPendingApproval } from './db.js';
export { isContactBlocked } from './db.js';

export function getPendingApprovals() {
  const { getPendingApprovals: getApprovals } = require('./db.js');
  return getApprovals();
}

export function getBlockedContacts() {
  const { getBlockedContacts: getBlocked } = require('./db.js');
  return getBlocked();
}
