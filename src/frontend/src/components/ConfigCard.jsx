import { useTranslation } from "react-i18next";
import { UtilityIcon } from "./Icons.jsx";

// A collapsible settings card. `enabled` is shown as a badge once known.
export default function ConfigCard({ title, enabled, open, onToggle, children }) {
    const { t } = useTranslation();
    return (
        <div className="card card-flush">
            <div className={`card-header--clickable ${open ? "is-open" : ""}`} onClick={onToggle}>
                <span className="section-label">{title}</span>
                <div className="flex-center">
                    {enabled !== undefined && <span className={`badge ${enabled ? "badge-green" : "badge-muted"}`}>{enabled ? t("common.enabledUpper") : t("common.disabledUpper")}</span>}
                    <span className="chevron"><UtilityIcon name={open ? "caretUp" : "caretDown"} /></span>
                </div>
            </div>
            {open && children}
        </div>
    );
}
