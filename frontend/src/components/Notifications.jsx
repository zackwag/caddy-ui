import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../utils/api.js";

const CUSTOM_SCHEMA = `{
  "title": "Upstream offline",
  "message": "example.com (10.0.0.5:8080) is unreachable",
  "priority": "high" | "default" | "low",
  "timestamp": "2026-08-18T12:00:00.000Z"
}`;

export default function Notifications({ toast, onUnauth }) {
    const [config, setConfig] = useState(null);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    const load = useCallback(() => {
        apiFetch('/notifications/config', {}, onUnauth).then(setConfig).catch(() => { });
    }, [onUnauth]);

    useEffect(() => { load(); }, [load]);

    if (!config) return <div className="loading">Loading...</div>;

    const update = (patch) => setConfig(c => ({ ...c, ...patch }));
    const updateNtfy = (patch) => setConfig(c => ({ ...c, ntfy: { ...c.ntfy, ...patch } }));
    const updateDiscord = (patch) => setConfig(c => ({ ...c, discord: { ...c.discord, ...patch } }));
    const updateSlack = (patch) => setConfig(c => ({ ...c, slack: { ...c.slack, ...patch } }));
    const updatePushover = (patch) => setConfig(c => ({ ...c, pushover: { ...c.pushover, ...patch } }));
    const updateCustom = (patch) => setConfig(c => ({ ...c, custom: { ...c.custom, ...patch } }));
    const updateTriggers = (patch) => setConfig(c => ({ ...c, triggers: { ...c.triggers, ...patch } }));

    const save = async () => {
        setSaving(true);
        try {
            const saved = await apiFetch('/notifications/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config),
            }, onUnauth);
            setConfig(saved);
            toast.success('Notification settings saved');
        } catch (err) {
            toast.error(err.message);
        } finally {
            setSaving(false);
        }
    };

    const test = async () => {
        setTesting(true);
        try {
            await apiFetch('/notifications/test', { method: 'POST' }, onUnauth);
            toast.success('Test notification sent');
        } catch (err) {
            toast.error(err.message);
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="gap-16">
            <div className="card">
                <div className="card-title">Notifications</div>

                <div className="field">
                    <label className="config-checkbox-label">
                        <input
                            type="checkbox"
                            className="config-checkbox"
                            checked={config.enabled}
                            onChange={e => update({ enabled: e.target.checked })}
                        />
                        Enable notifications
                    </label>
                </div>

                <div className="config-section-divider" />

                <div className="config-grid">
                    <div>
                        <label className="field-label">Provider</label>
                        <select
                            className="config-select"
                            value={config.provider}
                            onChange={e => update({ provider: e.target.value })}
                        >
                            <option value="ntfy">ntfy</option>
                            <option value="discord">Discord</option>
                            <option value="slack">Slack</option>
                            <option value="pushover">Pushover</option>
                            <option value="custom">Custom Webhook</option>
                        </select>
                    </div>
                </div>

                {config.provider === 'ntfy' && (
                    <div className="config-grid">
                        <div className="config-grid-full">
                            <label className="field-label">ntfy Topic URL</label>
                            <input
                                className="config-input"
                                type="url"
                                placeholder="https://ntfy.sh/my-caddy-alerts"
                                value={config.ntfy?.url || ''}
                                onChange={e => updateNtfy({ url: e.target.value })}
                            />
                        </div>
                    </div>
                )}

                {config.provider === 'discord' && (
                    <div className="config-grid">
                        <div className="config-grid-full">
                            <label className="field-label">Discord Webhook URL</label>
                            <input
                                className="config-input"
                                type="url"
                                placeholder="https://discord.com/api/webhooks/..."
                                value={config.discord?.webhookUrl || ''}
                                onChange={e => updateDiscord({ webhookUrl: e.target.value })}
                            />
                            <div className="hint" style={{ marginTop: '6px', marginBottom: 0 }}>
                                Server Settings &rarr; Integrations &rarr; Webhooks &rarr; New Webhook
                            </div>
                        </div>
                    </div>
                )}

                {config.provider === 'slack' && (
                    <div className="config-grid">
                        <div className="config-grid-full">
                            <label className="field-label">Slack Incoming Webhook URL</label>
                            <input
                                className="config-input"
                                type="url"
                                placeholder="https://hooks.slack.com/services/T.../B.../..."
                                value={config.slack?.webhookUrl || ''}
                                onChange={e => updateSlack({ webhookUrl: e.target.value })}
                            />
                            <div className="hint" style={{ marginTop: '6px', marginBottom: 0 }}>
                                Slack App &rarr; Incoming Webhooks &rarr; Add New Webhook to Workspace
                            </div>
                        </div>
                    </div>
                )}

                {config.provider === 'pushover' && (
                    <div className="config-grid">
                        <div className="config-grid-full">
                            <label className="field-label">User Key</label>
                            <input
                                className="config-input"
                                type="text"
                                placeholder="Your Pushover user key"
                                value={config.pushover?.userKey || ''}
                                onChange={e => updatePushover({ userKey: e.target.value })}
                            />
                        </div>
                        <div className="config-grid-full">
                            <label className="field-label">API Token</label>
                            <input
                                className="config-input"
                                type="text"
                                placeholder="Your application API token"
                                value={config.pushover?.apiToken || ''}
                                onChange={e => updatePushover({ apiToken: e.target.value })}
                            />
                            <div className="hint" style={{ marginTop: '6px', marginBottom: 0 }}>
                                Create an application at pushover.net/apps/build
                            </div>
                        </div>
                    </div>
                )}

                {config.provider === 'custom' && (
                    <>
                        <div className="config-grid">
                            <div className="config-grid-full">
                                <label className="field-label">Webhook URL</label>
                                <input
                                    className="config-input"
                                    type="url"
                                    placeholder="https://hooks.example.com/notify"
                                    value={config.custom?.url || ''}
                                    onChange={e => updateCustom({ url: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="field-label">HTTP Method</label>
                                <select
                                    className="config-select"
                                    value={config.custom?.method || 'POST'}
                                    onChange={e => updateCustom({ method: e.target.value })}
                                >
                                    <option value="POST">POST</option>
                                    <option value="PUT">PUT</option>
                                </select>
                            </div>
                        </div>
                        <div style={{ marginTop: '12px' }}>
                            <label className="field-label">JSON Payload Schema</label>
                            <pre className="history-preview" style={{ marginTop: '6px', whiteSpace: 'pre' }}>{CUSTOM_SCHEMA}</pre>
                            <div className="hint" style={{ marginTop: '6px', marginBottom: 0 }}>
                                This JSON body is POSTed with Content-Type: application/json on each alert.
                            </div>
                        </div>
                    </>
                )}
            </div>

            <div className="card">
                <div className="card-title">Triggers</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label className="config-checkbox-label">
                        <input
                            type="checkbox"
                            className="config-checkbox"
                            checked={config.triggers?.upstreamOffline ?? true}
                            onChange={e => updateTriggers({ upstreamOffline: e.target.checked })}
                        />
                        Upstream goes offline
                    </label>
                    <label className="config-checkbox-label">
                        <input
                            type="checkbox"
                            className="config-checkbox"
                            checked={config.triggers?.upstreamOnline ?? true}
                            onChange={e => updateTriggers({ upstreamOnline: e.target.checked })}
                        />
                        Upstream comes back online
                    </label>
                    <label className="config-checkbox-label">
                        <input
                            type="checkbox"
                            className="config-checkbox"
                            checked={config.triggers?.certExpiring ?? true}
                            onChange={e => updateTriggers({ certExpiring: e.target.checked })}
                        />
                        TLS certificate expiring within 14 days
                    </label>
                </div>
            </div>

            <div className="card">
                <div className="card-title">Debounce</div>
                <div className="config-grid">
                    <div>
                        <label className="field-label">Cooldown (minutes)</label>
                        <input
                            className="config-input"
                            type="number"
                            min="1"
                            max="1440"
                            value={config.debounceMinutes || 30}
                            onChange={e => update({ debounceMinutes: parseInt(e.target.value) || 30 })}
                        />
                    </div>
                </div>
                <div className="hint">
                    No repeat alerts for the same condition within this window.
                </div>
            </div>

            <div className="btn-row">
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                </button>
                <button className="btn btn-ghost" onClick={test} disabled={testing || !config.enabled}>
                    {testing ? 'Sending...' : 'Test notification'}
                </button>
            </div>
        </div>
    );
}
