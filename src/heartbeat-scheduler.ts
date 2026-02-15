/**
 * Heartbeat Scheduler for NanoClaw
 *
 * Implements OpenClaw-style proactive monitoring by scheduling periodic agent runs
 * that check HEARTBEAT.md for standing instructions. Automatically suppresses
 * HEARTBEAT_OK responses to avoid notification spam.
 */

import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';
import { GROUPS_DIR, MAIN_GROUP_FOLDER, TIMEZONE } from './config.js';
import { createTask, getTaskById } from './db.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface HeartbeatConfig {
  enabled: boolean;
  every: string; // e.g., "60m", "30m"
  activeHours?: {
    start: number; // 0-23
    end: number; // 0-23
    timezone: string;
  };
  suppressOk: boolean;
  maxSuppressedChars: number;
  prompt?: string;
}

/**
 * Parse interval string (e.g., "60m", "2h") to milliseconds
 */
function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)([mh])$/);
  if (!match) {
    throw new Error(
      `Invalid interval format: ${interval}. Use format like "60m" or "2h"`,
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === 'm') {
    return value * 60 * 1000;
  } else if (unit === 'h') {
    return value * 60 * 60 * 1000;
  }

  throw new Error(`Invalid interval unit: ${unit}`);
}

/**
 * Generate cron expression for hourly heartbeat within active hours
 * This creates a cron that runs every hour, but the actual check for active hours
 * happens in the heartbeat prompt logic.
 */
function generateHeartbeatCron(intervalMs: number): string {
  const minutes = Math.floor(intervalMs / (60 * 1000));

  if (minutes === 60) {
    // Every hour at minute 0
    return '0 * * * *';
  } else if (minutes < 60 && 60 % minutes === 0) {
    // Every N minutes (must be divisor of 60)
    return `*/${minutes} * * * *`;
  } else {
    // Fallback: use interval mode instead
    throw new Error(
      `Interval ${minutes}m cannot be expressed as cron (use 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, or 60 minutes)`,
    );
  }
}

/**
 * Load heartbeat configuration from group folder
 */
function loadHeartbeatConfig(groupFolder: string): HeartbeatConfig | null {
  const configPath = path.join(
    GROUPS_DIR,
    groupFolder,
    'heartbeat-config.json',
  );

  if (!fs.existsSync(configPath)) {
    logger.debug({ groupFolder }, 'No heartbeat config found');
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const data = JSON.parse(content);

    if (!data.heartbeat || !data.heartbeat.enabled) {
      logger.debug({ groupFolder }, 'Heartbeat disabled in config');
      return null;
    }

    return data.heartbeat as HeartbeatConfig;
  } catch (err) {
    logger.error({ err, groupFolder }, 'Failed to load heartbeat config');
    return null;
  }
}

/**
 * Create active hours check wrapper for heartbeat prompt
 */
function wrapPromptWithActiveHoursCheck(
  config: HeartbeatConfig,
  basePrompt: string,
): string {
  if (!config.activeHours) {
    return basePrompt;
  }

  const { start, end, timezone } = config.activeHours;

  return `Check the current time in ${timezone} timezone. If it's between ${start}:00 and ${end}:00 (${start} AM to ${end === 12 ? '12 PM' : end > 12 ? `${end - 12} PM` : `${end} AM`}), proceed with the heartbeat check. Otherwise, respond with just "HEARTBEAT_OK" (outside active hours).

If within active hours:
${basePrompt}`;
}

/**
 * Initialize heartbeat for a specific group
 */
export function initializeHeartbeat(
  groupFolder: string,
  chatJid: string,
  registeredGroup: RegisteredGroup,
): boolean {
  const config = loadHeartbeatConfig(groupFolder);

  if (!config || !config.enabled) {
    logger.debug({ groupFolder }, 'Heartbeat not enabled for group');
    return false;
  }

  try {
    // Parse interval
    const intervalMs = parseInterval(config.every);

    // Build heartbeat prompt
    const basePrompt =
      config.prompt ||
      'Read HEARTBEAT.md and follow the instructions. If nothing needs attention, respond with HEARTBEAT_OK.';
    const prompt = wrapPromptWithActiveHoursCheck(config, basePrompt);

    // Try to use cron for standard intervals, fall back to interval mode
    let scheduleType: 'cron' | 'interval';
    let scheduleValue: string;

    try {
      scheduleValue = generateHeartbeatCron(intervalMs);
      scheduleType = 'cron';
      logger.info(
        { groupFolder, cron: scheduleValue },
        'Using cron schedule for heartbeat',
      );
    } catch {
      // Fall back to interval mode
      scheduleValue = intervalMs.toString();
      scheduleType = 'interval';
      logger.info(
        { groupFolder, intervalMs },
        'Using interval schedule for heartbeat',
      );
    }

    // Create the scheduled task
    const taskId = `heartbeat-${groupFolder}`;

    // Calculate initial next_run time
    let nextRun: string | null = null;
    if (scheduleType === 'cron') {
      const interval = CronExpressionParser.parse(scheduleValue, {
        tz: config.activeHours?.timezone || 'America/Los_Angeles',
      });
      nextRun = interval.next().toISOString();
    } else if (scheduleType === 'interval') {
      nextRun = new Date(Date.now() + intervalMs).toISOString();
    }

    // Skip if task already exists (e.g. service restart)
    if (getTaskById(taskId)) {
      logger.info(
        { groupFolder, taskId },
        'Heartbeat task already exists, skipping creation',
      );
      return true;
    }

    createTask({
      id: taskId,
      group_folder: groupFolder,
      chat_jid: chatJid,
      prompt,
      schedule_type: scheduleType,
      schedule_value: scheduleValue,
      context_mode: 'group', // Use group context to maintain conversation continuity
      model: 'haiku', // Heartbeats use cheap model for routine checks
      next_run: nextRun,
      status: 'active',
      created_at: new Date().toISOString(),
    });

    logger.info(
      {
        groupFolder,
        taskId,
        scheduleType,
        scheduleValue,
        activeHours: config.activeHours,
      },
      'Heartbeat initialized',
    );

    return true;
  } catch (err) {
    logger.error({ err, groupFolder }, 'Failed to initialize heartbeat');
    return false;
  }
}

/**
 * Check if a message is a HEARTBEAT_OK response that should be suppressed
 */
export function isHeartbeatOk(
  message: string,
  maxChars: number = 300,
): boolean {
  const content = message.trim();

  // Check if message contains HEARTBEAT_OK
  const hasHeartbeatOk = /\bHEARTBEAT_OK\b/i.test(content);

  if (!hasHeartbeatOk) {
    return false;
  }

  // Remove HEARTBEAT_OK and check remaining content length
  const remaining = content
    .replace(/\bHEARTBEAT_OK\b/gi, '')
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .trim();

  // Suppress if remaining content is minimal
  if (remaining.length <= maxChars) {
    logger.debug(
      { messageLength: content.length, remainingLength: remaining.length },
      'Suppressing HEARTBEAT_OK message',
    );
    return true;
  }

  logger.debug(
    { remainingLength: remaining.length, maxChars },
    'HEARTBEAT_OK found but message has substantial content, not suppressing',
  );
  return false;
}

/**
 * Initialize heartbeat for all registered groups that have heartbeat-config.json
 */
export function initializeAllHeartbeats(
  registeredGroups: Record<string, RegisteredGroup>,
): void {
  logger.info('Initializing heartbeats for all groups');

  let initializedCount = 0;

  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (initializeHeartbeat(group.folder, jid, group)) {
      initializedCount++;
    }
  }

  if (initializedCount > 0) {
    logger.info({ count: initializedCount }, 'Heartbeats initialized');
  } else {
    logger.debug(
      'No heartbeats initialized (no groups have heartbeat-config.json with enabled: true)',
    );
  }
}
