import { useRef, useState } from "react";
import { useClickOutside } from "../hooks/useClickOutside.js";

function themeOptions(themes, mode) {
    const builtIn = themes.filter(t => t.mode === mode && !t.custom).sort((a, b) => a.label.localeCompare(b.label));
    const custom = themes.filter(t => t.mode === mode && t.custom).sort((a, b) => a.label.localeCompare(b.label));
    return { builtIn, custom };
}

export default function ThemePicker({ themes, mode, onToggleMode, darkPalette, lightPalette, onDarkPaletteChange, onLightPaletteChange }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);
    useClickOutside(menuRef, () => setOpen(false), open);

    const dark = themeOptions(themes, 'dark');
    const light = themeOptions(themes, 'light');

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
                                <optgroup label="Built-in">
                                    {dark.builtIn.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </optgroup>
                                {dark.custom.length > 0 && (
                                    <optgroup label="Custom">
                                        {dark.custom.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                    </optgroup>
                                )}
                            </select>
                            <span className="select-arrow">▾</span>
                        </div>
                    </div>
                    <div className="theme-picker-row">
                        <label>Light theme</label>
                        <div className="select-wrap">
                            <select className="config-select" value={lightPalette} onChange={e => onLightPaletteChange(e.target.value)}>
                                <optgroup label="Built-in">
                                    {light.builtIn.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </optgroup>
                                {light.custom.length > 0 && (
                                    <optgroup label="Custom">
                                        {light.custom.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                    </optgroup>
                                )}
                            </select>
                            <span className="select-arrow">▾</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
