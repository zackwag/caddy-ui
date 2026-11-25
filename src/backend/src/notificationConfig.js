import { createJsonStore } from './jsonFile.js';
import logger from './logger.js';
import { PROVIDERS } from './notificationDelivery.js';

const CONFIG_PATH = process.env.NOTIFICATIONS_CONFIG_PATH || '/etc/caddy-ui/notifications.json';

const DEFAULT_DEBOUNCE_MINUTES = 30;
const MAX_DEBOUNCE_MINUTES = 1440;

const DEFAULT_CONFIG = Object.freeze({
    enabled: false,
    provider: 'ntfy',
    ...Object.fromEntries(Object.entries(PROVIDERS).map(([name, provider]) => [name, provider.defaults])),
    triggers: {
        upstreamOffline: true,
        upstreamOnline: true,
        certExpiring: true,
        apiTokenExpiring: true,
        updateAvailable: true,
        // Need route checks on (Metrics page), so they start off
        routeOffline: false,
        routeOnline: false,
        authentication: false,
        configurationChange: false,
    },
    debounceMinutes: DEFAULT_DEBOUNCE_MINUTES,
});

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

// Every field present and of the type its readers expect, whatever was stored
// or submitted.
function normalize(input) {
    const value = isObject(input) ? input : {};
    const config = {
        enabled: value.enabled === true,
        provider: Object.hasOwn(PROVIDERS, value.provider) ? value.provider : DEFAULT_CONFIG.provider,
        triggers: Object.fromEntries(Object.entries(DEFAULT_CONFIG.triggers).map(([trigger, fallback]) => [
            trigger, typeof value.triggers?.[trigger] === 'boolean' ? value.triggers[trigger] : fallback,
        ])),
        debounceMinutes: Math.min(MAX_DEBOUNCE_MINUTES, Math.max(1, Math.round(Number(value.debounceMinutes)) || DEFAULT_DEBOUNCE_MINUTES)),
    };
    for (const name of Object.keys(PROVIDERS)) {
        config[name] = { ...DEFAULT_CONFIG[name], ...(isObject(value[name]) ? value[name] : {}) };
    }
    return config;
}

const store = createJsonStore(CONFIG_PATH, { parse: normalize });
const listeners = new Set();

export function loadNotificationConfig() {
    return store.load();
}

export function getNotificationConfig() {
    return store.get();
}

export async function saveNotificationConfig(input) {
    const config = await store.set(normalize(input));
    logger.info('Notifications config updated', { provider: config.provider, enabled: config.enabled });
    for (const listener of listeners) listener(config);
    return config;
}

export function onNotificationConfigChange(listener) {
    listeners.add(listener);
}

export function debounceMs(config) {
    return config.debounceMinutes * 60_000;
}
