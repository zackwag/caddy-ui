import { localizeError } from "../utils/errorMessages.js";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetch } from "../hooks/useFetch.js";
import { apiFetch } from "../utils/api.js";
import Select from "./Select.jsx";

// eslint-disable-next-line i18next/no-literal-string -- Example webhook payload, intentionally literal
const CUSTOM_SCHEMA = `{
  "title": "Upstream offline",
  "message": "example.com (10.0.0.5:8080) is unreachable",
  "priority": "high" | "default" | "low",
  "timestamp": "2026-08-18T12:00:00.000Z"
}`;

// eslint-disable-next-line i18next/no-literal-string -- Example provider endpoint
const NTFY_URL_PLACEHOLDER = "https://ntfy.sh/my-caddy-alerts";
// eslint-disable-next-line i18next/no-literal-string -- Example provider endpoint
const DISCORD_URL_PLACEHOLDER = "https://discord.com/api/webhooks/...";
// eslint-disable-next-line i18next/no-literal-string -- Example provider endpoint
const SLACK_URL_PLACEHOLDER = "https://hooks.slack.com/services/T.../B.../...";
// eslint-disable-next-line i18next/no-literal-string -- Example custom webhook endpoint
const CUSTOM_URL_PLACEHOLDER = "https://hooks.example.com/notify";

export default function Notifications({ toast }) {
    const { t } = useTranslation();
    const { data: config, error, setData: setConfig } = useFetch('/notifications/config');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    if (!config) return <div className="loading">{error ? localizeError(error, t) : t("common.loading")}</div>;

    const update = (patch) => setConfig(c => ({ ...c, ...patch }));
    const updateSection = (section, patch) => setConfig(c => ({ ...c, [section]: { ...c[section], ...patch } }));

    const save = async () => {
        setSaving(true);
        try {
            const saved = await apiFetch('/notifications/config', { method: 'PUT', json: config });
            setConfig(() => saved);
            toast.success(t("notifications.saved"));
        } catch (err) {
            toast.error(err);
        } finally {
            setSaving(false);
        }
    };

    const test = async () => {
        setTesting(true);
        try {
            await apiFetch('/notifications/test', { method: 'POST' });
            toast.success(t("notifications.testSent"));
        } catch (err) {
            toast.error(err);
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="gap-16">
            <div className="card">
                <div className="card-title">{t("notifications.title")}</div>

                <div className="field">
                    <button
                        type="button"
                        className={`btn notifications-enabled-btn ${config.enabled ? "btn-danger" : "btn-primary"}`}
                        onClick={() => update({ enabled: !config.enabled })}
                    >
                        {config.enabled ? t("notifications.disable") : t("notifications.enable")}
                    </button>
                </div>

                <div className="config-section-divider" />

                <div className="config-grid">
                    <div>
                        <label className="field-label">{t("notifications.provider")}</label>
                        <Select value={config.provider} onChange={e => update({ provider: e.target.value })}>
                            <option value="ntfy">ntfy</option>
                            <option value="discord">Discord</option>
                            <option value="slack">Slack</option>
                            <option value="pushover">Pushover</option>
                            <option value="custom">{t("notifications.customWebhook")}</option>
                        </Select>
                    </div>
                </div>

                {config.provider === 'ntfy' && (
                    <div className="config-grid">
                        <div className="config-grid-full">
                            <label className="field-label">{t("notifications.ntfyTopicUrl")}</label>
                            <input
                                className="config-input"
                                type="url"
                                placeholder={NTFY_URL_PLACEHOLDER}
                                value={config.ntfy.url}
                                onChange={e => updateSection('ntfy', { url: e.target.value })}
                            />
                        </div>
                    </div>
                )}

                {config.provider === 'discord' && (
                    <div className="config-grid">
                        <div className="config-grid-full">
                            <label className="field-label">{t("notifications.discordWebhookUrl")}</label>
                            <input
                                className="config-input"
                                type="url"
                                placeholder={DISCORD_URL_PLACEHOLDER}
                                value={config.discord.webhookUrl}
                                onChange={e => updateSection('discord', { webhookUrl: e.target.value })}
                            />
                            <div className="hint" style={{ marginTop: '6px', marginBottom: 0 }}>
                                {t("notifications.discordHint")}
                            </div>
                        </div>
                    </div>
                )}

                {config.provider === 'slack' && (
                    <div className="config-grid">
                        <div className="config-grid-full">
                            <label className="field-label">{t("notifications.slackWebhookUrl")}</label>
                            <input
                                className="config-input"
                                type="url"
                                placeholder={SLACK_URL_PLACEHOLDER}
                                value={config.slack.webhookUrl}
                                onChange={e => updateSection('slack', { webhookUrl: e.target.value })}
                            />
                            <div className="hint" style={{ marginTop: '6px', marginBottom: 0 }}>
                                {t("notifications.slackHint")}
                            </div>
                        </div>
                    </div>
                )}

                {config.provider === 'pushover' && (
                    <div className="config-grid">
                        <div className="config-grid-full">
                            <label className="field-label">{t("notifications.userKey")}</label>
                            <input
                                className="config-input"
                                type="text"
                                placeholder={t("notifications.userKeyPlaceholder")}
                                value={config.pushover.userKey}
                                onChange={e => updateSection('pushover', { userKey: e.target.value })}
                            />
                        </div>
                        <div className="config-grid-full">
                            <label className="field-label">{t("notifications.apiToken")}</label>
                            <input
                                className="config-input"
                                type="text"
                                placeholder={t("notifications.apiTokenPlaceholder")}
                                value={config.pushover.apiToken}
                                onChange={e => updateSection('pushover', { apiToken: e.target.value })}
                            />
                            <div className="hint" style={{ marginTop: '6px', marginBottom: 0 }}>
                                {t("notifications.pushoverHint")}
                            </div>
                        </div>
                    </div>
                )}

                {config.provider === 'custom' && (
                    <>
                        <div className="config-grid">
                            <div className="config-grid-full">
                                <label className="field-label">{t("notifications.webhookUrl")}</label>
                                <input
                                    className="config-input"
                                    type="url"
                                    placeholder={CUSTOM_URL_PLACEHOLDER}
                                    value={config.custom.url}
                                    onChange={e => updateSection('custom', { url: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="field-label">{t("notifications.httpMethod")}</label>
                                <Select value={config.custom.method} onChange={e => updateSection('custom', { method: e.target.value })}>
                                    <option value="POST">POST</option>
                                    <option value="PUT">PUT</option>
                                </Select>
                            </div>
                        </div>
                        <div style={{ marginTop: '12px' }}>
                            <label className="field-label">{t("notifications.jsonSchema")}</label>
                            <pre className="history-preview" style={{ marginTop: '6px', whiteSpace: 'pre' }}>{CUSTOM_SCHEMA}</pre>
                            <div className="hint" style={{ marginTop: '6px', marginBottom: 0 }}>
                                {t("notifications.jsonSchemaHint")}
                            </div>
                        </div>
                    </>
                )}
            </div>

            <div className="card">
                <div className="card-title">{t("notifications.triggers")}</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {Object.entries(config.triggers).map(([trigger, enabled]) => (
                        <label key={trigger} className="config-checkbox-label">
                            <input
                                type="checkbox"
                                className="config-checkbox"
                                checked={enabled}
                                onChange={e => updateSection('triggers', { [trigger]: e.target.checked })}
                            />
                            {t(`notifications.${trigger}`)}
                        </label>
                    ))}
                </div>
                <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
                    {t("notifications.routeAlertHint")}
                </div>
                <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
                    {t("notifications.authenticationHint")}
                </div>
                <div className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
                    {t("notifications.configurationChangeHint")}
                </div>
            </div>

            <div className="card">
                <div className="card-title">{t("notifications.debounce")}</div>
                <div className="config-grid">
                    <div>
                        <label className="field-label">{t("notifications.cooldownMinutes")}</label>
                        <input
                            className="config-input"
                            type="number"
                            min="1"
                            max="1440"
                            value={config.debounceMinutes}
                            onChange={e => update({ debounceMinutes: parseInt(e.target.value) || 30 })}
                        />
                    </div>
                </div>
                <div className="hint">
                    {t("notifications.cooldownHint")}
                </div>
            </div>

            <div className="btn-row notif-footer-actions">
                <button className="btn btn-primary notif-save-btn" onClick={save} disabled={saving}>
                    {saving ? t("common.saving") : t("common.save")}
                </button>
                <button className="btn btn-ghost notif-test-btn" onClick={test} disabled={testing || !config.enabled}>
                    {testing ? t("notifications.sending") : t("notifications.testNotification")}
                </button>
            </div>
        </div>
    );
}
