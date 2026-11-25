import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { collapseUnchanged, diffLines } from "../utils/lineDiff.js";

export default function CaddyfileDiff({ oldText, newText, previewRef, label }) {
    const { t } = useTranslation();
    const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
    const added = lines.filter(l => l.type === "add").length;
    const removed = lines.filter(l => l.type === "del").length;
    const shown = useMemo(() => collapseUnchanged(lines), [lines]);

    if (!added && !removed) return <div ref={previewRef} className="history-preview history-diff-empty" role="region" aria-label={label || t("caddyfile.versionPreview")} tabIndex={0}>{t("caddyfile.noDifferences")}</div>;

    return (
        <>
            <div className="history-diff-stats">
                <span className="diff-stat--add">+{added}</span> <span className="diff-stat--del">−{removed}</span>
            </div>
            <div ref={previewRef} className="history-preview history-diff" role="region" aria-label={label || t("caddyfile.versionPreview")} tabIndex={0}>
                <div className="history-diff-lines">
                    {shown.map((line, i) => line.type === "skip" ? (
                        <div key={i} className="diff-skip">⋯ {t("caddyfile.unchangedLines", { count: line.count })}</div>
                    ) : (
                        <div key={i} className={`diff-line diff-line--${line.type}`}>
                            <span className="diff-ln">{line.oldNo ?? ""}</span>
                            <span className="diff-ln">{line.newNo ?? ""}</span>
                            <span className="diff-sign">{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>
                            <span className="diff-text">{line.text}</span>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}
