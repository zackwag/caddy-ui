import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClickOutside } from "../hooks/useClickOutside.js";
import { THEME_VAR_KEYS } from "../styles.js";
import { downloadText } from "../utils/download.js";
import { PixelIcon, UtilityIcon } from "./Icons.jsx";
import ThemeSelect from "./ThemeSelect.jsx";

// Downloads a theme in the custom-theme file format src/backend/src/customThemes.js
// validates, ready to drop into THEMES_PATH/<mode>/ and edit. Custom ids are
// `custom-<mode>-<filename slug>`, so stripping the prefix round-trips the
// original filename.
function exportTheme(theme) {
    const json = JSON.stringify({
        label: theme.label,
        vars: Object.fromEntries(THEME_VAR_KEYS.map(k => [k, theme.vars[k]])),
    }, null, 2);
    downloadText(`${theme.custom ? theme.id.replace(`custom-${theme.mode}-`, '') : theme.id}.json`, json + '\n', 'application/json');
}

export default function ThemePicker({ themes, mode, onToggleMode, darkPalette, lightPalette, onDarkPaletteChange, onLightPaletteChange }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);
    useClickOutside(menuRef, () => setOpen(false), open);

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
                        <ThemeSelect themes={themes} mode="dark" value={darkPalette} onChange={onDarkPaletteChange} />
                    </div>
                    <div className="theme-picker-row">
                        <label>{t("themePicker.lightTheme")}</label>
                        <ThemeSelect themes={themes} mode="light" value={lightPalette} onChange={onLightPaletteChange} />
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
