import { useState } from "react";
import { THEME_LIST } from "../styles.js";

const DARK_THEMES = THEME_LIST.filter(t => t.mode === 'dark').sort((a, b) => a.label.localeCompare(b.label));
const LIGHT_THEMES = THEME_LIST.filter(t => t.mode === 'light').sort((a, b) => a.label.localeCompare(b.label));

export default function ThemeWelcome({ onComplete }) {
    const [dark, setDark] = useState('vt2026');
    const [light, setLight] = useState('coarse-everywhere');
    const [preview, setPreview] = useState('dark');

    const activeId = preview === 'dark' ? dark : light;
    const activeTheme = THEME_LIST.find(t => t.id === activeId) || THEME_LIST[0];

    return (
        <div className="modal-overlay">
            <div className="modal" style={{ width: 500 }}>
                <div className="modal-title">Choose your themes</div>
                <div className="modal-hint">Pick a palette for each mode. You can change these anytime from the top bar.</div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <button
                        className={`btn ${preview === 'dark' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setPreview('dark')}
                    >Dark</button>
                    <button
                        className={`btn ${preview === 'light' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setPreview('light')}
                    >Light</button>
                </div>

                <div style={{ marginBottom: 16 }}>
                    <label className="field-label">{preview === 'dark' ? 'Dark theme' : 'Light theme'}</label>
                    <div className="select-wrap">
                        <select
                            className="config-select"
                            value={preview === 'dark' ? dark : light}
                            onChange={e => preview === 'dark' ? setDark(e.target.value) : setLight(e.target.value)}
                        >
                            {(preview === 'dark' ? DARK_THEMES : LIGHT_THEMES).map(t =>
                                <option key={t.id} value={t.id}>{t.label}</option>
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
                            }}>caddy</span>
                            <span style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 10,
                                color: activeTheme.vars['--muted'],
                                letterSpacing: 2,
                                textTransform: 'uppercase',
                            }}>UI</span>
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
                            }}>Preview</div>
                            <div style={{ display: 'flex', gap: 16 }}>
                                {[
                                    { label: 'Accent', color: activeTheme.vars['--accent'] },
                                    { label: 'Info', color: activeTheme.vars['--accent2'] },
                                    { label: 'Highlight', color: activeTheme.vars['--accent3'] },
                                    { label: 'Danger', color: activeTheme.vars['--danger'] },
                                    { label: 'Warn', color: activeTheme.vars['--warn'] },
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
                            localhost:443 &#123; reverse_proxy backend:8080 &#125;
                        </div>
                    </div>
                </div>

                <div className="flex-end">
                    <button className="btn btn-primary" onClick={() => onComplete(dark, light)}>
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
}
