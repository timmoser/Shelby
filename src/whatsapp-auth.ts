/**
 * WhatsApp Authentication Script
 *
 * Run this during setup to authenticate with WhatsApp.
 * Displays QR code, waits for scan, saves credentials, then exits.
 *
 * Usage: npx tsx src/whatsapp-auth.ts
 *        npx tsx src/whatsapp-auth.ts --pairing-code
 */
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import readline from 'readline';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';

import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

const AUTH_DIR = './store/auth';
const USE_PAIRING_CODE = process.argv.includes('--pairing-code');
const MAX_RETRIES = 5;

const logger = pino({
  level: 'silent',
});

async function askPhoneNumber(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Enter your phone number (with country code, e.g. 14155551234): ', (answer) => {
      rl.close();
      resolve(answer.replace(/[^0-9]/g, ''));
    });
  });
}

async function startSocket(state: any, saveCreds: () => Promise<void>): Promise<void> {
  let retries = 0;

  const connect = () => {
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: USE_PAIRING_CODE ? ['Chrome (Linux)', '', ''] : ['NanoClaw', 'Chrome', '1.0.0'],
    });

    let pairingCodeRequested = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !USE_PAIRING_CODE) {
        console.log('\nScan this QR code with WhatsApp:\n');
        console.log('  1. Open WhatsApp on your phone');
        console.log('  2. Tap Settings → Linked Devices → Link a Device');
        console.log('  3. Point your camera at the QR code below\n');
        qrcode.generate(qr, { small: true });

        // Also save as image file for easier scanning
        const qrPath = path.join(process.cwd(), 'qr-code.png');
        try {
          await QRCode.toFile(qrPath, qr, { scale: 8, margin: 2 });
          console.log(`\n  QR code also saved to: ${qrPath}`);
          console.log('  Run: open qr-code.png  (to view in Preview)\n');
        } catch {}
      }

      if (qr && USE_PAIRING_CODE && !pairingCodeRequested) {
        pairingCodeRequested = true;
        try {
          const phoneNumber = await askPhoneNumber();
          const code = await sock.requestPairingCode(phoneNumber);
          console.log(`\nYour pairing code: ${code}\n`);
          console.log('On your phone:');
          console.log('  1. Open WhatsApp → Settings → Linked Devices');
          console.log('  2. Tap "Link a Device"');
          console.log('  3. Tap "Link with phone number instead"');
          console.log(`  4. Enter this code: ${code}\n`);
        } catch (err: any) {
          console.error('Failed to get pairing code:', err.message);
          process.exit(1);
        }
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as any)?.output?.statusCode;

        if (reason === DisconnectReason.loggedOut) {
          console.log('\n✗ Logged out. Delete store/auth and try again.');
          process.exit(1);
        }

        retries++;
        if (retries >= MAX_RETRIES) {
          console.log(`\n✗ Failed after ${MAX_RETRIES} attempts. Please try again later.`);
          process.exit(1);
        }

        console.log(`\nQR expired, generating new one... (attempt ${retries + 1}/${MAX_RETRIES})`);
        setTimeout(connect, 2000);
      }

      if (connection === 'open') {
        console.log('\n✓ Successfully authenticated with WhatsApp!');
        console.log('  Credentials saved to store/auth/');
        console.log('  You can now start the NanoClaw service.\n');

        // Clean up QR image
        try { fs.unlinkSync(path.join(process.cwd(), 'qr-code.png')); } catch {}

        // Give it a moment to save credentials, then exit
        setTimeout(() => process.exit(0), 1000);
      }
    });

    sock.ev.on('creds.update', saveCreds);
  };

  connect();
}

async function authenticate(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  if (state.creds.registered) {
    console.log('✓ Already authenticated with WhatsApp');
    console.log(
      '  To re-authenticate, delete the store/auth folder and run again.',
    );
    process.exit(0);
  }

  console.log('Starting WhatsApp authentication...\n');

  if (USE_PAIRING_CODE) {
    console.log('Using pairing code method (no QR scan needed).\n');
  } else {
    console.log('A QR code will appear below and also be saved as qr-code.png.');
    console.log('If the terminal QR is hard to scan, run: open qr-code.png\n');
  }

  await startSocket(state, saveCreds);
}

authenticate().catch((err) => {
  console.error('Authentication failed:', err.message);
  process.exit(1);
});
