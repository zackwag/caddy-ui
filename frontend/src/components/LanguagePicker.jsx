import { UtilityIcon } from "./Icons.jsx";
import { useTranslation } from "react-i18next";
import { languageName } from '../i18n/index.js';

export default function LanguagePicker({
    languages,
    language,
    onLanguageChange,
}) {
    const { t } = useTranslation();

    return (
        <div className="theme-picker language-picker">
            <span className="theme-toggle language-picker-value">
                {languageName(language)}
            </span>

            <span className="theme-picker-trigger language-picker-arrow">
                <UtilityIcon name="caretDown" size={10} />
            </span>

            <select
                className="config-select language-picker-select"
                value={language}
                onChange={e => onLanguageChange(e.target.value)}
                aria-label={t("languagePicker.chooseLanguage")}
                title={t("languagePicker.chooseLanguage")}
            >
                {languages.map(lang => (
                    <option key={lang} value={lang}>
                        {languageName(lang)}
                    </option>
                ))}
            </select>
        </div>
    );
}
