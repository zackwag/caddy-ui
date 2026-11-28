import { useTranslation } from "react-i18next";
import Select from "./Select.jsx";

// The themes of one mode, built-in and custom apart.
export default function ThemeSelect({ themes, mode, value, onChange }) {
    const { t } = useTranslation();
    const options = custom => themes.filter(theme => theme.mode === mode && !!theme.custom === custom)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(theme => <option key={theme.id} value={theme.id}>{theme.label}</option>);
    const custom = options(true);
    return (
        <Select value={value} onChange={e => onChange(e.target.value)}>
            <optgroup label={t("themePicker.builtIn")}>{options(false)}</optgroup>
            {custom.length > 0 && <optgroup label={t("themePicker.custom")}>{custom}</optgroup>}
        </Select>
    );
}
