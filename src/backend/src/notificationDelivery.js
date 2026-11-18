import logger from './logger.js';
import { sendWebhook } from './webhookTransport.js';

const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const isHigh = priority => priority === 'high';

// Each provider names its settings (with their defaults), the one it can't
// send without, and the request for an alert of `high`, `default` or `low`
// priority.
export const PROVIDERS = {
    ntfy: {
        label: 'ntfy',
        defaults: { url: '' },
        missing: settings => !settings.url && 'ntfy URL not configured',
        request: (settings, { title, message, priority }) => ({
            url: settings.url,
            headers: { 'Title': title, 'Priority': priority || 'default', 'Content-Type': 'text/plain; charset=utf-8' },
            body: message,
        }),
    },
    discord: {
        label: 'Discord',
        defaults: { webhookUrl: '' },
        missing: settings => !settings.webhookUrl && 'Discord webhook URL not configured',
        request: (settings, { title, message, priority }) => ({
            url: settings.webhookUrl,
            ...json({ embeds: [{
                title,
                description: message,
                color: isHigh(priority) ? 0xff4d6a : 0x00e5a0,
                timestamp: new Date().toISOString(),
                footer: { text: 'caddy/ui' },
            }] }),
        }),
    },
    slack: {
        label: 'Slack',
        defaults: { webhookUrl: '' },
        missing: settings => !settings.webhookUrl && 'Slack webhook URL not configured',
        request: (settings, { title, message, priority }) => ({
            url: settings.webhookUrl,
            ...json({ text: `${isHigh(priority) ? ':rotating_light:' : ':white_check_mark:'} *${title}*\n${message}` }),
        }),
    },
    pushover: {
        label: 'Pushover',
        defaults: { userKey: '', apiToken: '' },
        missing: settings => (!settings.userKey || !settings.apiToken) && 'Pushover user key and API token required',
        request: (settings, { title, message, priority }) => ({
            url: 'https://api.pushover.net/1/messages.json',
            ...json({ token: settings.apiToken, user: settings.userKey, title, message, priority: isHigh(priority) ? 1 : 0 }),
        }),
    },
    custom: {
        label: 'Custom webhook',
        defaults: { url: '', method: 'POST' },
        missing: settings => !settings.url && 'Custom webhook URL not configured',
        request: (settings, { title, message, priority }) => ({
            url: settings.url,
            method: settings.method || 'POST',
            ...json({ title, message, priority, timestamp: new Date().toISOString() }),
        }),
    },
};

export async function sendNotification(config, alert) {
    const provider = PROVIDERS[config.provider];
    if (!provider) throw new Error(`Unknown provider: ${config.provider}`);
    const settings = config[config.provider] || {};
    const missing = provider.missing(settings);
    if (missing) throw new Error(missing);
    const { url, ...request } = provider.request(settings, alert);
    await sendWebhook(url, { name: provider.label, ...request });
    logger.info(`Notification sent via ${provider.label}`, { title: alert.title });
}
