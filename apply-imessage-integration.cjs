#!/usr/bin/env node
/**
 * Script to apply iMessage integration changes to index.ts
 */
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'src/index.ts');
let content = fs.readFileSync(indexPath, 'utf-8');

console.log('Applying iMessage integration changes...');

// 1. Update setTyping function
const oldSetTyping = `async function setTyping(jid: string, isTyping: boolean): Promise<void> {
  try {
    await sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);
  } catch (err) {
    logger.debug({ jid, err }, 'Failed to update typing status');
  }
}`;

const newSetTyping = `async function setTyping(jid: string, isTyping: boolean): Promise<void> {
  if (jid.startsWith('imsg:')) {
    if (isTyping) await setIMessageTyping(jid);
    return;
  }
  if (jid.startsWith('tg:')) {
    if (isTyping) await setTelegramTyping(jid);
    return;
  }
  try {
    await sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);
  } catch (err) {
    logger.debug({ jid, err }, 'Failed to update typing status');
  }
}`;

content = content.replace(oldSetTyping, newSetTyping);
console.log('✓ Updated setTyping function');

// 2. Update sendMessage function to add routing
const sendMessagePattern =
  /async function sendMessage\(jid: string, text: string\): Promise<void> \{\s*if \(!waConnected\) \{/;
const sendMessageReplacement = `async function sendMessage(jid: string, text: string): Promise<void> {
  // Route iMessage messages
  if (jid.startsWith('imsg:')) {
    await sendIMessage(jid, text);
    return;
  }

  // Route Telegram messages
  if (jid.startsWith('tg:')) {
    await sendTelegramMessage(jid, text);
    return;
  }

  // WhatsApp path (with outgoing queue for reconnection)
  if (!waConnected) {`;

content = content.replace(sendMessagePattern, sendMessageReplacement);
console.log('✓ Updated sendMessage function');

// 3. Update getAvailableGroups filter
const oldFilter = `.filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@g.us'))`;
const newFilter = `.filter((c) => c.jid !== '__group_sync__' && (c.jid.endsWith('@g.us') || c.jid.startsWith('tg:') || c.jid.startsWith('imsg:')))`;

content = content.replace(oldFilter, newFilter);
console.log('✓ Updated getAvailableGroups filter');

// 4. Add IPC handlers before the default case
const ipcDefaultCase = `    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}`;

const ipcHandlers = `    case 'approve_imessage_contact':
      // Only main group can approve contacts
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized approve_imessage_contact attempt blocked');
        break;
      }
      if (data.chatJid) {
        approveIMessageContact(data.chatJid, registerGroup)
          .then((result) => {
            if (result.success) {
              logger.info({ chatJid: data.chatJid }, 'iMessage contact approved');
            } else {
              logger.error({ chatJid: data.chatJid, error: result.error }, 'Failed to approve iMessage contact');
            }
          })
          .catch((err) => {
            logger.error({ err, chatJid: data.chatJid }, 'Error approving contact');
          });
      } else {
        logger.warn({ data }, 'Invalid approve_imessage_contact request - missing chatJid');
      }
      break;

    case 'deny_imessage_contact':
      // Only main group can deny contacts
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized deny_imessage_contact attempt blocked');
        break;
      }
      if (data.chatJid) {
        denyIMessageContact(data.chatJid, data.reason)
          .then((result) => {
            if (result.success) {
              logger.info({ chatJid: data.chatJid }, 'iMessage contact denied and blocked');
            } else {
              logger.error({ chatJid: data.chatJid, error: result.error }, 'Failed to deny iMessage contact');
            }
          })
          .catch((err) => {
            logger.error({ err, chatJid: data.chatJid }, 'Error denying contact');
          });
      } else {
        logger.warn({ data }, 'Invalid deny_imessage_contact request - missing chatJid');
      }
      break;

    case 'list_pending_imessage_approvals':
      // Only main group can list pending approvals
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized list_pending_imessage_approvals attempt blocked');
        break;
      }
      try {
        const pending = getPendingApprovals();
        logger.info({ count: pending.length }, 'Listed pending iMessage approvals');
      } catch (err) {
        logger.error({ err }, 'Error listing pending approvals');
      }
      break;

    case 'list_blocked_imessage_contacts':
      // Only main group can list blocked contacts
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized list_blocked_imessage_contacts attempt blocked');
        break;
      }
      try {
        const blocked = getBlockedContacts();
        logger.info({ count: blocked.length }, 'Listed blocked iMessage contacts');
      } catch (err) {
        logger.error({ err }, 'Error listing blocked contacts');
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}`;

content = content.replace(ipcDefaultCase, ipcHandlers);
console.log('✓ Added IPC handlers');

// 5. Update main() function
const oldMain = `async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  await connectWhatsApp();
}`;

const newMain = `async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    stopIMessage();
    stopTelegram();
    await queue.shutdown(10000);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start iMessage if configured
  const hasIMessage = !!IMESSAGE_SERVER_URL && !!IMESSAGE_PASSWORD;
  if (hasIMessage) {
    await connectIMessage(
      IMESSAGE_SERVER_URL,
      IMESSAGE_PASSWORD,
      IMESSAGE_WEBHOOK_PORT,
    );
  }

  // Start Telegram bot if configured
  const hasTelegram = !!TELEGRAM_BOT_TOKEN;
  if (hasTelegram) {
    await connectTelegram(TELEGRAM_BOT_TOKEN);
  }

  if (!TELEGRAM_ONLY && !IMESSAGE_ONLY) {
    await connectWhatsApp();
  } else {
    // Messaging-only mode: start services without WhatsApp
    startSchedulerLoop({
      registeredGroups: () => registeredGroups,
      getSessions: () => sessions,
      queue,
      onProcess: (groupJid, proc, containerName, groupFolder) =>
        queue.registerProcess(groupJid, proc, containerName, groupFolder),
      sendMessage,
      assistantName: ASSISTANT_NAME,
    });
    startIpcWatcher();
    queue.setProcessMessagesFn(processGroupMessages);
    recoverPendingMessages();
    startMessageLoop();

    const channels = [];
    if (hasIMessage) channels.push('iMessage');
    if (hasTelegram) channels.push('Telegram');
    logger.info(
      \`NanoClaw running (\${channels.join(' + ')}, trigger: @\${ASSISTANT_NAME})\`,
    );
  }
}`;

content = content.replace(oldMain, newMain);
console.log('✓ Updated main() function');

// Write back
fs.writeFileSync(indexPath, content, 'utf-8');
console.log('\n✅ All changes applied successfully!');
console.log('Run "npm run build" to compile.');
