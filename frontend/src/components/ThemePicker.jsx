import { useRef, useState } from "react";
import { useClickOutside } from "../hooks/useClickOutside.js";
import { THEME_LIST } from "../styles.js";

const DARK_THEMES = THEME_LIST.filter(t => t.mode === 'dark').sort((a, b) => a.label.localeCompare(b.label));
const LIGHT_THEMES = THEME_LIST.filter(t => t.mode === 'light').sort((a, b) => a.label.localeCompare(b.label));

export default function ThemePicker({ mode, onToggleMode, darkPalette, lightPalette, onDarkPaletteChange, onLightPaletteChange }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);
    useClickOutside(menuRef, () => setOpen(false), open);

    return (
        <div className="theme-picker" ref={menuRef}>
            <button className="theme-toggle" onClick={onToggleMode} title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                {mode === 'dark' ? '☀︎' : '☾︎'}
            </button>
            <button className="theme-picker-trigger" onClick={() => setOpen(o => !o)} title="Choose themes">⌄</button>
            {open && (
                <div className="theme-picker-menu">
                    <div className="theme-picker-row">
                        <label>Dark theme</label>
                        <div className="select-wrap">
                            <select className="config-select" value={darkPalette} onChange={e => onDarkPaletteChange(e.target.value)}>
                                {DARK_THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                            </select>
                            <span className="select-arrow">▾</span>
                        </div>
                    </div>
                    <div className="theme-picker-row">
                        <label>Light theme</label>
                        <div className="select-wrap">
                            <select className="config-select" value={lightPalette} onChange={e => onLightPaletteChange(e.target.value)}>
                                {LIGHT_THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                            </select>
                            <span className="select-arrow">▾</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
