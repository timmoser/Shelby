/**
 * File watcher using inotifywait for push notifications
 * Monitors directories for file changes and emits events
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import readline from 'readline';

export interface FileChangeEvent {
  path: string;
  event: string;
}

export class FileWatcher extends EventEmitter {
  private process: ChildProcess | null = null;
  private watchDirs: string[];

  constructor(watchDirs: string[]) {
    super();
    this.watchDirs = watchDirs.filter(dir => existsSync(dir));
  }

  start(): void {
    if (this.process) {
      throw new Error('Watcher already started');
    }

    if (this.watchDirs.length === 0) {
      console.error('[file-watcher] No directories to watch');
      return;
    }

    console.error(`[file-watcher] Watching: ${this.watchDirs.join(', ')}`);

    // Spawn inotifywait in monitor mode
    this.process = spawn('inotifywait', [
      '-m',  // Monitor mode (continuous)
      '-q',  // Quiet (only output events)
      '-e', 'create,moved_to,modify,close_write',
      '--format', '%w%f|%e',
      ...this.watchDirs,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Parse output line by line
    const rl = readline.createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      const [filepath, event] = line.split('|');
      if (!filepath) return;

      // Skip temporary and hidden files
      const filename = filepath.split('/').pop() || '';
      if (filename.startsWith('.') || filename.endsWith('~') || filename.endsWith('.tmp')) {
        return;
      }

      // Emit change event
      this.emit('change', { path: filepath, event });
    });

    this.process.on('error', (err) => {
      console.error('[file-watcher] Process error:', err);
      this.emit('error', err);
    });

    this.process.on('exit', (code) => {
      console.error(`[file-watcher] Process exited with code ${code}`);
      this.process = null;
    });
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
