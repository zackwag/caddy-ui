import { createCaddyfileHistory } from './caddyfileHistory.js';

// Polling and management writes share one store and one identity registry.
export const configurationHistory = createCaddyfileHistory(process.env.HISTORY_PATH || '/etc/caddy-ui/history');
