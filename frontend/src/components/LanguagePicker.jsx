import { useTranslation } from "react-i18next";

export default function LanguagePicker({
    languages,
    language,
    onLanguageChange,
}) {
    const { t } = useTranslation();

    return (
        <div className="theme-picker language-picker">
            <span className="theme-toggle language-picker-value">
                {language.toUpperCase()}
            </span>

            <span className="theme-picker-trigger language-picker-arrow">
                ▾
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
                        {lang.toUpperCase()}
                    </option>
                ))}
            </select>
        </div>
    );
}