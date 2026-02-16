import Database from 'better-sqlite3';
import { exec } from 'child_process';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { ASSISTANT_NAME, POLL_INTERVAL } from '../config.js';
import {
  addPendingApproval,
  getPendingApproval,
  isContactBlocked,
  storeChatMetadata,
  storeMessageDirect,
} from '../db.js';
import { logger } from '../logger.js';
import { Channel, OnInboundMessage, RegisteredGroup } from '../types.js';

const execPromise = promisify(exec);

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

export interface IMessageChannelOpts {
  onMessage: OnInboundMessage;
  onApprovalRequest?: (
    chatJid: string,
    contactInfo: string,
    firstMessage: string | null,
  ) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
}

export class IMessageChannel implements Channel {
  name = 'imessage';
  prefixAssistantName = false; // iMessage shows as you, not as a bot

  private pollingInterval: NodeJS.Timeout | null = null;
  private lastProcessedRowId = 0;
  private connected = false;
  private opts: IMessageChannelOpts;

  constructor(opts: IMessageChannelOpts) {
    this.opts = opts;
  }

  /** Normalize chat GUID to consistent format: imsg:{contactId} */
  private normalizeChatGuid(contactId: string): string {
    return `imsg:${contactId}`;
  }

  async connect(): Promise<void> {
    // Initialize last processed row ID
    try {
      const db = new Database(MESSAGES_DB_PATH, { readonly: true });
      const result = db
        .prepare('SELECT MAX(ROWID) as maxId FROM message')
        .get() as { maxId: number };
      this.lastProcessedRowId = result.maxId || 0;
      db.close();
      logger.info(
        { lastProcessedRowId: this.lastProcessedRowId },
        'Initialized with current max message ID',
      );
    } catch (err) {
      logger.error({ err }, 'Failed to initialize iMessage last processed ID');
      throw err;
    }

    // Start polling
    this.pollingInterval = setInterval(
      () => this.pollMessages(),
      POLL_INTERVAL,
    );
    this.connected = true;

    logger.info(
      { interval: `${POLL_INTERVAL / 1000}s` },
      'iMessage database polling started',
    );
  }

  private async pollMessages(): Promise<void> {
    let db: Database.Database | null = null;
    try {
      logger.info(
        { lastProcessedRowId: this.lastProcessedRowId },
        'Querying for new messages',
      );

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
      const messages = stmt.all(this.lastProcessedRowId) as MessageRow[];

      logger.info(
        { count: messages.length, lastProcessedRowId: this.lastProcessedRowId },
        'Query completed',
      );

      for (const msg of messages) {
        await this.processMessage(msg);
        this.lastProcessedRowId = msg.ROWID;
      }
    } catch (err) {
      logger.error({ err }, 'Error querying Messages database');
    } finally {
      if (db) {
        try {
          db.close();
        } catch (err) {
          logger.error({ err }, 'Error closing Messages database');
        }
      }
    }
  }

  private async processMessage(msg: MessageRow): Promise<void> {
    // Skip messages from us
    if (msg.is_from_me) {
      logger.debug({ guid: msg.guid }, 'Skipping outgoing message');
      return;
    }

    // Skip non-iMessage
    if (msg.service !== 'iMessage') {
      logger.debug(
        { guid: msg.guid, service: msg.service },
        'Skipping non-iMessage',
      );
      return;
    }

    const sender = msg.sender || 'unknown';
    const chatId = msg.chat_identifier || sender;
    const chatJid = this.normalizeChatGuid(chatId);
    const text = msg.text || '';

    // Convert Apple timestamp (nanoseconds since 2001-01-01) to ISO string
    const appleEpoch = new Date('2001-01-01T00:00:00Z').getTime();
    const timestamp = new Date(appleEpoch + msg.date / 1_000_000).toISOString();

    logger.info(
      { chatJid, sender, text: text.slice(0, 50) },
      'iMessage received',
    );

    // Store chat metadata
    storeChatMetadata(chatJid, timestamp, chatId);

    // Check if contact is blocked
    if (isContactBlocked(chatJid)) {
      logger.info({ chatJid }, 'Message from blocked contact, ignoring');
      return;
    }

    // Check if contact is registered
    const registeredGroups = this.opts.registeredGroups();
    const isRegistered = !!registeredGroups[chatJid];

    if (!isRegistered) {
      // Check if already pending approval
      const pending = getPendingApproval(chatJid);
      if (!pending) {
        logger.info(
          { chatJid, sender },
          'New iMessage contact, adding to pending approvals',
        );
        addPendingApproval(chatJid, chatId, text);

        if (this.opts.onApprovalRequest) {
          await this.opts.onApprovalRequest(chatJid, chatId, text);
        }
      }
      return;
    }

    // Store and forward the message
    storeMessageDirect({
      id: msg.guid,
      chat_jid: chatJid,
      sender,
      sender_name: sender.split('@')[0],
      content: text,
      timestamp,
      is_from_me: false,
    });

    logger.info({ chatJid }, 'iMessage stored');

    // Notify via callback
    this.opts.onMessage(chatJid, {
      id: msg.guid,
      chat_jid: chatJid,
      sender,
      sender_name: sender.split('@')[0],
      content: text,
      timestamp,
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // Extract contact ID from jid (imsg:+1234567890 -> +1234567890)
    const contactId = jid.replace('imsg:', '');

    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');

    const script = `
      tell application "Messages"
        set targetService to 1st account whose service type = iMessage
        set targetBuddy to participant "${contactId}" of targetService
        send "${escapedText}" to targetBuddy
      end tell
    `;

    try {
      await execPromise(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      logger.info({ jid, length: text.length }, 'iMessage sent');

      // Store our own message
      storeMessageDirect({
        id: `${Date.now()}-outgoing`,
        chat_jid: jid,
        sender: 'me',
        sender_name: ASSISTANT_NAME,
        content: text,
        timestamp: new Date().toISOString(),
        is_from_me: true,
      });
    } catch (err) {
      logger.error({ err, jid }, 'Failed to send iMessage');
      throw err;
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    // iMessage doesn't have a typing indicator API we can use
    // This is a no-op
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('imsg:');
  }

  async disconnect(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.connected = false;
    logger.info('iMessage polling stopped');
  }
}

// Helper functions for iMessage contact approval (called from IPC)
export async function approveIMessageContact(
  chatJid: string,
  channel: IMessageChannel,
  opts: Pick<IMessageChannelOpts, 'registeredGroups' | 'registerGroup'>,
): Promise<void> {
  const pending = getPendingApproval(chatJid);
  if (!pending) {
    throw new Error(`No pending approval for ${chatJid}`);
  }

  const { removePendingApproval } = await import('../db.js');

  // Create isolated agent for this contact
  const timestamp = Date.now();
  const folder = `imessage-${chatJid.replace('imsg:', '').replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}`;

  opts.registerGroup(chatJid, {
    name: `${pending.contact_info} (iMessage)`,
    folder,
    trigger: '@' + (await import('../config.js')).ASSISTANT_NAME,
    added_at: new Date().toISOString(),
    requiresTrigger: false, // Auto-respond to all messages
  });

  removePendingApproval(chatJid);

  await channel.sendMessage(
    chatJid,
    `✓ Connected! I'm your personal assistant. How can I help?`,
  );

  logger.info({ chatJid, folder }, 'iMessage contact approved and registered');
}

export async function denyIMessageContact(chatJid: string): Promise<void> {
  const pending = getPendingApproval(chatJid);
  if (!pending) {
    throw new Error(`No pending approval for ${chatJid}`);
  }

  const { removePendingApproval, addBlockedContact } = await import('../db.js');

  addBlockedContact(chatJid, pending.contact_info, 'Denied by user');
  removePendingApproval(chatJid);

  logger.info({ chatJid }, 'iMessage contact denied and blocked');
}
