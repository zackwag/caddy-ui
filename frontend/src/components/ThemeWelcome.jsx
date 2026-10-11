import { useState } from "react";
import { useTranslation } from "react-i18next";

// eslint-disable-next-line i18next/no-literal-string -- Brand text in the theme preview
const BRAND_CADDY = "caddy";
// eslint-disable-next-line i18next/no-literal-string -- Brand text in the theme preview
const BRAND_UI = "UI";
// eslint-disable-next-line i18next/no-literal-string -- Caddyfile syntax example
const CADDYFILE_PREVIEW = "localhost:443 { reverse_proxy backend:8080 }";

function themeOptions(themes, mode) {
    const builtIn = themes.filter(t => t.mode === mode && !t.custom).sort((a, b) => a.label.localeCompare(b.label));
    const custom = themes.filter(t => t.mode === mode && t.custom).sort((a, b) => a.label.localeCompare(b.label));
    return { builtIn, custom };
}

export default function ThemeWelcome({ themes, languages, language, onLanguageChange, onComplete }) {
    const { t } = useTranslation();
    const [dark, setDark] = useState('vt2026');
    const [light, setLight] = useState('coarse-everywhere');
    const [preview, setPreview] = useState('dark');

    const activeId = preview === 'dark' ? dark : light;
    const activeTheme = themes.find(t => t.id === activeId) || themes[0];
    const options = themeOptions(themes, preview);

    return (
        <div className="modal-overlay">
            <div className="modal" style={{ width: 500 }}>
                <div className="modal-title">{t("themeWelcome.title")}</div>
                <div className="modal-hint">{t("themeWelcome.hint")}</div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <button
                        className={`btn ${preview === 'dark' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setPreview('dark')}
                    >{t("themeWelcome.dark")}</button>
                    <button
                        className={`btn ${preview === 'light' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setPreview('light')}
                    >{t("themeWelcome.light")}</button>
                </div>

                <div style={{ marginBottom: 16 }}>
                    <label className="field-label">{preview === 'dark' ? t("themeWelcome.darkTheme") : t("themeWelcome.lightTheme")}</label>
                    <div className="select-wrap">
                        <select
                            className="config-select"
                            value={preview === 'dark' ? dark : light}
                            onChange={e => preview === 'dark' ? setDark(e.target.value) : setLight(e.target.value)}
                        >
                            <optgroup label={t("themeWelcome.builtIn")}>
                                {options.builtIn.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                            </optgroup>
                            {options.custom.length > 0 && (
                                <optgroup label={t("themeWelcome.custom")}>
                                    {options.custom.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </optgroup>
                            )}
                        </select>
                        <span className="select-arrow">▾</span>
                    </div>
                </div>

                <div style={{
                    borderRadius: 6,
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    marginBottom: 20,
                }}>
                    <div style={{
                        background: activeTheme.vars['--bg'],
                        padding: 16,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 14,
                                fontWeight: 600,
                                color: activeTheme.vars['--accent'],
                            }}>{BRAND_CADDY}</span>
                            <span style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 10,
                                color: activeTheme.vars['--muted'],
                                letterSpacing: 2,
                                textTransform: 'uppercase',
                            }}>{BRAND_UI}</span>
                        </div>
                        <div style={{
                            background: activeTheme.vars['--surface'],
                            border: `1px solid ${activeTheme.vars['--border']}`,
                            borderRadius: 4,
                            padding: 12,
                        }}>
                            <div style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 10,
                                letterSpacing: 1.5,
                                textTransform: 'uppercase',
                                color: activeTheme.vars['--muted'],
                                marginBottom: 8,
                            }}>{t("themeWelcome.preview")}</div>
                            <div style={{ display: 'flex', gap: 16 }}>
                                {[
                                    { label: t("themeWelcome.accent"), color: activeTheme.vars['--accent'] },
                                    { label: t("themeWelcome.info"), color: activeTheme.vars['--accent2'] },
                                    { label: t("themeWelcome.highlight"), color: activeTheme.vars['--accent3'] },
                                    { label: t("themeWelcome.danger"), color: activeTheme.vars['--danger'] },
                                    { label: t("themeWelcome.warn"), color: activeTheme.vars['--warn'] },
                                ].map(s => (
                                    <div key={s.label} style={{ textAlign: 'center' }}>
                                        <div style={{
                                            width: 24,
                                            height: 24,
                                            borderRadius: 4,
                                            background: s.color,
                                            marginBottom: 4,
                                        }} />
                                        <div style={{
                                            fontFamily: 'var(--mono)',
                                            fontSize: 9,
                                            color: activeTheme.vars['--muted'],
                                        }}>{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div style={{
                            background: activeTheme.vars['--editor-bg'],
                            border: `1px solid ${activeTheme.vars['--editor-border']}`,
                            borderRadius: 4,
                            padding: '8px 12px',
                            fontFamily: 'var(--mono)',
                            fontSize: 11,
                            color: activeTheme.vars['--editor-text'],
                        }}>
                            {CADDYFILE_PREVIEW}
                        </div>
                    </div>
                </div>

                {languages.length > 1 && (
                    <div style={{ marginBottom: 16 }}>
                        <label className="field-label">{t("themeWelcome.language")}</label>
                        <div className="select-wrap">
                            <select
                                className="config-select"
                                value={language}
                                onChange={e => onLanguageChange(e.target.value)}
                            >
                                {languages.map(lang => (
                                    <option key={lang} value={lang}>
                                        {lang.toUpperCase()}
                                    </option>
                                ))}
                            </select>
                            <span className="select-arrow">▾</span>
                        </div>
                    </div>
                )}

                <div className="flex-end">
                    <button className="btn btn-primary" onClick={() => onComplete(dark, light)}>
                        {t("themeWelcome.apply")}
                    </button>
                </div>
            </div>
        </div>
    );
}
