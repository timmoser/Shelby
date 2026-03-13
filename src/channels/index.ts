/**
 * Channel barrel file.
 * Each channel self-registers via registerChannel() when imported.
 * Channels that detect missing credentials return null from their factory.
 */

// --- iMessage channel ---
import './imessage.js';

// --- Future channels (add imports here) ---
// import './whatsapp.js';
// import './telegram.js';

export {
  registerChannel,
  getChannelFactory,
  getRegisteredChannelNames,
} from './registry.js';
export type { ChannelOpts, ChannelFactory } from './registry.js';
