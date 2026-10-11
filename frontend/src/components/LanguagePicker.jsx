export default function LanguagePicker({
    languages,
    language,
    onLanguageChange,
}) {
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
                aria-label="Choose language"
                title="Choose language"
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