/**
 * Collaboration Folder Watcher
 * Monitors collaboration folders on the host and triggers agents when files change
 * Uses fswatch on macOS, inotifywait on Linux
 */
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import readline from 'readline';
import path from 'path';
import os from 'os';

import { logger } from './logger.js';
import { IMESSAGE_COLLABORATION_FOLDER } from './config.js';

export interface CollaborationFileChange {
  path: string;
  event: string;
}

export class CollaborationWatcher extends EventEmitter {
  private process: ChildProcess | null = null;
  private watchDirs: string[];

  constructor() {
    super();
    // Watch collaboration folder and iCloud shared folder
    this.watchDirs = [
      IMESSAGE_COLLABORATION_FOLDER,
      path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Shelby'),
    ].filter(dir => existsSync(dir));
  }

  start(): void {
    if (this.process) {
      throw new Error('Collaboration watcher already started');
    }

    if (this.watchDirs.length === 0) {
      logger.warn('No collaboration directories to watch');
      return;
    }

    logger.info({ dirs: this.watchDirs }, 'Starting collaboration folder watcher');

    // Try fswatch first (macOS native), then inotifywait (Linux)
    const isMac = process.platform === 'darwin';

    if (isMac) {
      this.startFswatch();
    } else {
      this.startInotifywait();
    }
  }

  private startFswatch(): void {
    try {
      // fswatch outputs one line per event with the full path
      this.process = spawn('fswatch', [
        '-r',  // Recursive
        '-l', '0.5',  // Latency: 0.5 seconds (batch events)
        ...this.watchDirs,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const rl = readline.createInterface({
        input: this.process.stdout!,
        crlfDelay: Infinity,
      });

      rl.on('line', (filepath) => {
        if (!filepath) return;

        // Skip temporary and hidden files
        const filename = path.basename(filepath);
        if (filename.startsWith('.') || filename.endsWith('~') || filename.endsWith('.tmp')) {
          return;
        }

        logger.debug({ filepath, event: 'changed' }, 'Collaboration folder change detected (fswatch)');
        this.emit('change', { path: filepath, event: 'modified' });
      });

      this.process.on('error', (err) => {
        logger.error({ err }, 'fswatch process error');
        this.emit('error', err);
      });

      this.process.on('exit', (code) => {
        logger.warn({ code }, 'fswatch process exited');
        this.process = null;
        // Auto-restart after 5 seconds if it crashes
        setTimeout(() => {
          if (!this.process) {
            logger.info('Restarting fswatch');
            try {
              this.start();
            } catch (err) {
              logger.error({ err }, 'Failed to restart fswatch');
            }
          }
        }, 5000);
      });

      logger.info('Collaboration watcher started (fswatch)');
    } catch (err) {
      logger.error({ err }, 'Failed to start fswatch');
      throw err;
    }
  }

  private startInotifywait(): void {
    try {
      this.process = spawn('inotifywait', [
        '-m',  // Monitor mode (continuous)
        '-q',  // Quiet (only output events)
        '-r',  // Recursive
        '-e', 'create,moved_to,modify,close_write,delete',
        '--format', '%w%f|%e',
        ...this.watchDirs,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const rl = readline.createInterface({
        input: this.process.stdout!,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        const [filepath, event] = line.split('|');
        if (!filepath) return;

        // Skip temporary and hidden files
        const filename = path.basename(filepath);
        if (filename.startsWith('.') || filename.endsWith('~') || filename.endsWith('.tmp')) {
          return;
        }

        logger.debug({ filepath, event }, 'Collaboration folder change detected (inotifywait)');
        this.emit('change', { path: filepath, event });
      });

      this.process.on('error', (err) => {
        logger.error({ err }, 'inotifywait process error');
        this.emit('error', err);
      });

      this.process.on('exit', (code) => {
        logger.warn({ code }, 'inotifywait process exited');
        this.process = null;
        // Auto-restart after 5 seconds if it crashes
        setTimeout(() => {
          if (!this.process) {
            logger.info('Restarting inotifywait');
            try {
              this.start();
            } catch (err) {
              logger.error({ err }, 'Failed to restart inotifywait');
            }
          }
        }, 5000);
      });

      logger.info('Collaboration watcher started (inotifywait)');
    } catch (err) {
      logger.error({ err }, 'Failed to start inotifywait');
      throw err;
    }
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  getWatchedDirs(): string[] {
    return [...this.watchDirs];
  }
}
