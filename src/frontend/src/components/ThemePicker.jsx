import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClickOutside } from "../hooks/useClickOutside.js";
import { THEME_VAR_KEYS } from "../styles.js";
import { PixelIcon, UtilityIcon } from "./Icons.jsx";

function themeOptions(themes, mode) {
    const builtIn = themes.filter(t => t.mode === mode && !t.custom).sort((a, b) => a.label.localeCompare(b.label));
    const custom = themes.filter(t => t.mode === mode && t.custom).sort((a, b) => a.label.localeCompare(b.label));
    return { builtIn, custom };
}

// Downloads a theme in the custom-theme file format src/backend/src/customThemes.js
// validates, ready to drop into THEMES_PATH/<mode>/ and edit. Custom ids are
// `custom-<mode>-<filename slug>`, so stripping the prefix round-trips the
// original filename.
function exportTheme(theme) {
    const json = JSON.stringify({
        label: theme.label,
        vars: Object.fromEntries(THEME_VAR_KEYS.map(k => [k, theme.vars[k]])),
    }, null, 2);
    const blob = new Blob([json + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${theme.custom ? theme.id.replace(`custom-${theme.mode}-`, '') : theme.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

export default function ThemePicker({ themes, mode, onToggleMode, darkPalette, lightPalette, onDarkPaletteChange, onLightPaletteChange }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);
    useClickOutside(menuRef, () => setOpen(false), open);

    const dark = themeOptions(themes, 'dark');
    const light = themeOptions(themes, 'light');
    const active = themes.find(t => t.id === (mode === 'dark' ? darkPalette : lightPalette));

    return (
        <div className="theme-picker" ref={menuRef}>
            <button className="theme-toggle" onClick={onToggleMode} title={mode === 'dark' ? t("themePicker.switchToLight") : t("themePicker.switchToDark")} aria-label={mode === 'dark' ? t("themePicker.switchToLight") : t("themePicker.switchToDark")}>
                <PixelIcon name={mode === 'dark' ? 'sun' : 'moon'} />
            </button>
            <button className="theme-picker-trigger" onClick={() => setOpen(o => !o)} title={t("themePicker.chooseThemes")} aria-label={t("themePicker.chooseThemes")} aria-expanded={open}><UtilityIcon name="caretDown" /></button>
            {open && (
                <div className="theme-picker-menu">
                    <div className="theme-picker-row">
                        <label>{t("themePicker.darkTheme")}</label>
                        <div className="select-wrap">
                            <select className="config-select" value={darkPalette} onChange={e => onDarkPaletteChange(e.target.value)}>
                                <optgroup label={t("themePicker.builtIn")}>
                                    {dark.builtIn.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </optgroup>
                                {dark.custom.length > 0 && (
                                    <optgroup label={t("themePicker.custom")}>
                                        {dark.custom.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                    </optgroup>
                                )}
                            </select>
                            <span className="select-arrow"><UtilityIcon name="caretDown" size={10} /></span>
                        </div>
                    </div>
                    <div className="theme-picker-row">
                        <label>{t("themePicker.lightTheme")}</label>
                        <div className="select-wrap">
                            <select className="config-select" value={lightPalette} onChange={e => onLightPaletteChange(e.target.value)}>
                                <optgroup label={t("themePicker.builtIn")}>
                                    {light.builtIn.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </optgroup>
                                {light.custom.length > 0 && (
                                    <optgroup label={t("themePicker.custom")}>
                                        {light.custom.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                    </optgroup>
                                )}
                            </select>
                            <span className="select-arrow"><UtilityIcon name="caretDown" size={10} /></span>
                        </div>
                    </div>
                    {active && (
                        <div className="theme-picker-row theme-picker-export">
                            <button
                                className="btn btn-ghost btn--sm"
                                onClick={() => exportTheme(active)}
                                title={t("themePicker.exportTitle", { label: active.label, mode: active.mode })}
                            ><UtilityIcon name="download" /> {t("themePicker.exportJson", { label: active.label })}</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
