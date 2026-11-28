import { UtilityIcon } from "./Icons.jsx";
import { localizeError } from "../utils/errorMessages.js";
import { useCallback, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useLoad } from "../hooks/usePoll.js";
import { useSort } from "../hooks/useSort.jsx";
import { apiFetch, instanceUrl } from "../utils/api.js";
import { formatDate } from "../utils/format.js";

const STATUS_COLORS = { expired: "var(--danger)", expiring: "var(--warn)" };

export default function TLS({ toast, confirm }) {
    const { t } = useTranslation();
    const [certs, setCerts] = useState([]);
    const [loading, setLoading] = useState(true);
    // Kept until a load succeeds, so unreadable storage isn't shown as "no certificates"
    const [loadError, setLoadError] = useState(null);
    const [filter, setFilter] = useState("all");
    const sort = useSort("domain");

    const load = useCallback(signal => {
        setLoading(true);
        toast.track('tls.load', apiFetch("/tls", { signal }), { signal })
            .then(data => { setLoadError(null); setCerts(data); })
            .catch(setLoadError)
            .finally(() => setLoading(false));
    }, [toast]);

    useLoad(load);

    const deleteCert = async (cert) => {
        if (!await confirm(t("tls.deleteConfirm", { status: cert.status, domain: cert.domain }), { confirmLabel: t("tls.delete"), danger: true })) {
            return;
        }
        try {
            await apiFetch(`/tls/${encodeURIComponent(cert.domain)}?issuer=${encodeURIComponent(cert.issuerDir)}`, { method: "DELETE" });
            toast.success(t("tls.deleted", { domain: cert.domain })); load();
        } catch (e) { toast.error(e); }
    };

    const isInUse = cert => cert.status !== 'orphaned' && cert.status !== 'superseded';
    const count = status => certs.filter(cert => cert.status === status).length;
    const summary = {
        total: certs.filter(isInUse).length,
        valid: count('valid'),
        expiring: count('expiring'),
        expired: count('expired'),
        orphaned: count('orphaned'),
        superseded: count('superseded'),
    };

    const filtered = filter === "all"
        ? certs.filter(isInUse)
        : certs.filter(c => c.status === filter);

    // Only the local CA's certificates renew themselves; the rest count down
    const daysLeft = cert => cert.isInternal ? Infinity : cert.daysRemaining;
    const compare = {
        domain: (a, b) => a.domain.localeCompare(b.domain),
        expires: (a, b) => new Date(a.validTo) - new Date(b.validTo),
        days: (a, b) => daysLeft(a) === daysLeft(b) ? 0 : daysLeft(a) - daysLeft(b),
    }[sort.column];
    const sorted = [...filtered].sort((a, b) => sort.ascending ? compare(a, b) : compare(b, a));

    const statusBadge = (cert) => {
        if (cert.status === 'expired') {
            return <span className="badge badge-red">{t("tls.expiredUpper")}</span>;
        }
        if (cert.status === 'expiring') {
            return <span className="badge badge-yellow">{t("tls.expiringUpper")}</span>;
        }
        if (cert.status === 'orphaned') {
            return <span className="badge badge-muted">{t("tls.orphanedUpper")}</span>;
        }
        if (cert.status === 'superseded') {
            return <span className="badge badge-yellow">{t("tls.supersededUpper")}</span>;
        }
        return <span className="badge badge-green">{t("tls.validUpper")}</span>;
    };

    const expiryBar = (cert) => {
        if (cert.isInternal) {
            return null;
        }
        // The share of its lifetime left, whatever its validity period
        const validTo = new Date(cert.validTo);
        const remaining = (validTo - Date.now()) / (validTo - new Date(cert.validFrom));
        const pct = Number.isFinite(remaining) ? Math.max(0, Math.min(1, remaining)) * 100 : 0;
        const color = STATUS_COLORS[cert.status] || 'var(--accent)';
        return <div className="expiry-bar"><div className="expiry-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>;
    };

    const filterCards = [
        { key: "all", label: t("tls.total"), val: summary.total, sub: t("tls.managedCerts"), color: null },
        { key: "valid", label: t("tls.valid"), val: summary.valid, sub: t("tls.healthy"), color: "var(--accent)" },
        { key: "expiring", label: t("tls.expiring"), val: summary.expiring, sub: t("tls.within14Days"), color: summary.expiring > 0 ? "var(--warn)" : null },
        { key: "expired", label: t("tls.expired"), val: summary.expired, sub: t("tls.needsRenewal"), color: summary.expired > 0 ? "var(--danger)" : null },
    ];

    if (loading) {
        return <div className="loading">{t("tls.loadingCertificates")}</div>;
    }

    return (
        <div className="gap-16">
            <div className="card">
                <div className="flex-between">
                    <div>
                        <div className="card-title" style={{ marginBottom: 4 }}>{t("tls.rootCaCertificate")}</div>
                        <div className="hint" style={{ maxWidth: 480, marginBottom: 10 }}>
                            <Trans i18nKey="tls.rootCaHint" components={{ tld: <span style={{ color: "var(--accent)" }} /> }} />
                        </div>
                        <div className="flex-col-sm">
                            {[
                                { os: "iOS / iPadOS", instruction: t("tls.iosInstruction") },
                                { os: "macOS", instruction: t("tls.macosInstruction") },
                                { os: "Android", instruction: t("tls.androidInstruction") },
                                { os: "Windows", instruction: t("tls.windowsInstruction") },
                            ].map(({ os, instruction }) => (
                                <div key={os} className="hint" style={{ marginBottom: 0 }}>
                                    <span style={{ color: "var(--text)" }}>{os}</span> — {instruction}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="btn-row tls-ca-actions">
                        <button className="btn btn-ghost tls-refresh--mobile" onClick={() => load()}><UtilityIcon name="refresh" /> {t("common.refresh")}</button>
                        <button className="btn btn-primary" onClick={() => window.open(instanceUrl('/tls/ca'), '_blank')}><UtilityIcon name="arrowDown" /> {t("tls.downloadRootCa")}</button>
                    </div>
                </div>
            </div>

            <div className="grid-4">
                {filterCards.map(({ key, label, val, sub, color }) => (
                    <div
                        key={key}
                        className="card card-clickable"
                        style={filter === key ? { borderColor: "var(--accent)" } : undefined}
                        onClick={() => setFilter(key)}
                    >
                        <div className="card-title">{label}</div>
                        <div className="stat-val" style={{ color: color || "var(--text)" }}>{val}</div>
                        <div className="stat-label">{sub}</div>
                    </div>
                ))}
            </div>

            <div className="card card-flush">
                <div className="card-header">
                    <span className="section-label">
                        {t("tls.certificates")} {filter !== "all" && `— ${t(`tls.filter.${filter}`)}`}
                    </span>
                    <div className="btn-row">
                        {summary.orphaned > 0 && (
                            <span
                                className="section-label"
                                style={{ color: filter === "orphaned" ? "var(--accent)" : "var(--muted)", cursor: "pointer" }}
                                onClick={() => setFilter(filter === "orphaned" ? "all" : "orphaned")}
                            >
                                {t("tls.orphanedCount", { count: summary.orphaned })}
                            </span>
                        )}
                        {summary.superseded > 0 && (
                            <span
                                className="section-label"
                                style={{ color: filter === "superseded" ? "var(--accent)" : "var(--warn)", cursor: "pointer" }}
                                onClick={() => setFilter(filter === "superseded" ? "all" : "superseded")}
                            >
                                {t("tls.supersededCount", { count: summary.superseded })}
                            </span>
                        )}
                        <button className="btn btn-ghost btn--sm tls-refresh--desktop" onClick={() => load()}><UtilityIcon name="refresh" /> {t("common.refresh")}</button>
                    </div>
                </div>
                {sorted.length === 0 ? (
                    <div className="card-empty">
                        {loadError && !certs.length ? localizeError(loadError, t) : filter === "orphaned" ? t("tls.noOrphaned") : filter === "superseded" ? t("tls.noSuperseded") : t("tls.noCertificates")}
                    </div>
                ) : (
                    <div className="table-wrap">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th className="th-sortable" {...sort.header("domain")}>{t("tls.domain")} {sort.icon("domain")}</th>
                                    <th>{t("tls.issuer")}</th>
                                    <th className="th-sortable" {...sort.header("expires")}>{t("tls.expires")} {sort.icon("expires")}</th>
                                    <th className="th-sortable" {...sort.header("days")}>{t("tls.days")} {sort.icon("days")}</th>
                                    <th>{t("tls.status")}</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((cert, i) => (
                                    <tr key={i} style={{ opacity: isInUse(cert) ? 1 : 0.6 }}>
                                        <td className="mono">{cert.domain}</td>
                                        <td><span className={`badge ${cert.issuer === 'acme' ? 'badge-blue' : 'badge-muted'}`}>{cert.issuer === 'acme' ? "Let's Encrypt" : t("tls.internal")}</span></td>
                                        <td>
                                            <div className="mono" style={{ fontSize: 12 }}>{formatDate(cert.validTo)}</div>
                                            {expiryBar(cert)}
                                        </td>
                                        <td className="mono" style={{ color: STATUS_COLORS[cert.status] || "var(--muted)" }}>
                                            {cert.isInternal ? t("tls.auto") : t("tls.daysShort", { count: cert.daysRemaining })}
                                        </td>
                                        <td>{statusBadge(cert)}</td>
                                        <td className="col-actions-sm">
                                            {cert.deletable && <button className="btn btn-danger btn--icon" onClick={() => deleteCert(cert)} aria-label={t("tls.delete")}><UtilityIcon name="close" /></button>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
