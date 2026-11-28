import { afterAll, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_EVENTS, PRIORITIES, VARIABLES, renderNotification, renderTemplate, templateVariables } from '../src/notificationEvents.js';
import { notificationsFixture } from './fixtures/notifications.mjs';

vi.mock('../src/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const notifications = await notificationsFixture();
const { getNotificationConfig } = await import('../src/notificationConfig.js');
const triggers = Object.keys(getNotificationConfig().triggers);
afterAll(() => notifications.close());

describe('notification events', () => {
    it.each(Object.entries(NOTIFICATION_EVENTS))('%s uses only documented variables it declares', (_, event) => {
        for (const name of event.variables) {
            expect(VARIABLES).toHaveProperty(name);
        }
        for (const template of [event.title, event.message]) {
            expect(event.variables).toEqual(expect.arrayContaining(templateVariables(template)));
        }
        expect(PRIORITIES).toContain(event.priority);
    });

    it('turns each event on with an existing trigger, and covers every trigger', () => {
        const used = new Set(Object.values(NOTIFICATION_EVENTS).map(event => event.trigger).filter(Boolean));
        expect([...used].sort()).toEqual([...triggers].sort());
    });

    it('offers no secrets as variables', () => {
        expect(Object.keys(VARIABLES).filter(name => /secret|password|hash|credential|apiKey|userKey/i.test(name))).toEqual([]);
    });

    it('renders the test notification without data', () => {
        expect(renderNotification('test')).toEqual({ title: 'caddy/ui test', message: 'Notifications are working correctly.', priority: 'low' });
    });

    it('refuses an unknown event', () => {
        expect(() => renderNotification('upstream.exploded')).toThrow(/Unknown notification event/);
    });
});

describe('notification templates', () => {
    it('replaces each variable with its value as text', () => {
        expect(renderTemplate('{count} of {route}', { count: 0, route: 'a.example' })).toBe('0 of a.example');
    });

    it('leaves out a line whose variables are all empty, and keeps lines without variables', () => {
        expect(renderTemplate('Fixed\nEntry: {historyEntry}\n{instancePrefix}{route} down', { historyEntry: null, instancePrefix: '', route: 'a.example' }))
            .toBe('Fixed\na.example down');
    });

    it('evaluates nothing: values are inserted as written, and only plain names are placeholders', () => {
        const data = { route: '{failure} ${process.exit()}', failure: 'HTTP 502' };
        expect(renderTemplate('{route} | ${failure} | {constructor} | {a.b} | {toString}', data))
            .toBe('{failure} ${process.exit()} | $HTTP 502 |  | {a.b} | ');
    });
});
