import { UtilityIcon } from "./Icons.jsx";
import { localizeError } from "../utils/errorMessages.js";
import { useCallback, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { apiFetch, getToken, getInstanceId } from "../utils/api.js";
import { currentLocale } from "../utils/format.js";
import { stateNotificationKey } from "../utils/notificationCenter.js";

export default function TLS({ toast, onUnauth, confirm }) {
    const { t } = useTranslation();
    const [certs, setCerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [sortCol, setSortCol] = useState("domain");
    const [sortDir, setSortDir] = useState("asc");

    const load = useCallback(() => {
        setLoading(true);
        const key = stateNotificationKey('tls.load', getInstanceId());
        apiFetch("/tls", {}, onUnauth)
            .then(data => { toast.recover(key); setCerts(data); })
            .catch(e => toast.error(localizeError(e, t), e, { mode: 'state', key }))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- toast isn't stable across renders
    }, [onUnauth]);

    useEffect(load, [load]);

    const deleteCert = async (cert) => {
        if (!await confirm(t("tls.deleteConfirm", { status: cert.status, domain: cert.domain }), { confirmLabel: t("tls.delete"), danger: true })) return;
        try {
            await apiFetch(`/tls/${cert.domain}`, { method: "DELETE" }, onUnauth);
            toast.success(t("tls.deleted", { domain: cert.domain })); load();
        } catch (e) { toast.error(localizeError(e, t), e); }
    };

    const downloadCA = () => {
        const token = getToken();
        window.open(token ? `/api/tls/ca?token=${token}` : `/api/tls/ca`, '_blank');
    };

    const summary = {
        total: certs.filter(c => c.status !== 'orphaned' && c.status !== 'superseded').length,
        valid: certs.filter(c => c.status === 'valid').length,
        expiring: certs.filter(c => c.status === 'expiring').length,
        expired: certs.filter(c => c.status === 'expired').length,
        orphaned: certs.filter(c => c.status === 'orphaned').length,
        superseded: certs.filter(c => c.status === 'superseded').length,
    };

    const filtered = filter === "all"
        ? certs.filter(c => c.status !== 'orphaned' && c.status !== 'superseded')
        : certs.filter(c => c.status === filter);

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSortCol(col); setSortDir("asc"); }
    };

    const sorted = [...filtered].sort((a, b) => {
        if (sortCol === "expires") { const va = new Date(a.validTo).getTime(), vb = new Date(b.validTo).getTime(); return sortDir === "asc" ? va - vb : vb - va; }
        if (sortCol === "days") { const va = a.isInternal ? Infinity : a.daysRemaining, vb = b.isInternal ? Infinity : b.daysRemaining; return sortDir === "asc" ? va - vb : vb - va; }
        return sortDir === "asc" ? a.domain.localeCompare(b.domain) : b.domain.localeCompare(a.domain);
    });

    const SortIcon = ({ col }) => {
        if (sortCol !== col) return <span className="sort-icon"><UtilityIcon name="sort" /></span>;
        return <span className="sort-icon--active"><UtilityIcon name={sortDir === "asc" ? "arrowUp" : "arrowDown"} /></span>;
    };

    const statusBadge = (cert) => {
        if (cert.status === 'expired') return <span className="badge badge-red">{t("tls.expiredUpper")}</span>;
        if (cert.status === 'expiring') return <span className="badge badge-yellow">{t("tls.expiringUpper")}</span>;
        if (cert.status === 'orphaned') return <span className="badge badge-muted">{t("tls.orphanedUpper")}</span>;
        if (cert.status === 'superseded') return <span className="badge badge-yellow">{t("tls.supersededUpper")}</span>;
        return <span className="badge badge-green">{t("tls.validUpper")}</span>;
    };

    const expiryBar = (cert) => {
        if (cert.isInternal) return null;
        const pct = Math.max(0, Math.min(100, (cert.daysRemaining / 90) * 100));
        const color = cert.daysRemaining < 0 ? 'var(--danger)' : cert.daysRemaining < 14 ? 'var(--warn)' : 'var(--accent)';
        return <div className="expiry-bar"><div className="expiry-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>;
    };

    const formatDate = (dateStr) => {
        try { return new Date(dateStr).toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric', year: 'numeric' }); }
        catch { return dateStr; }
    };

    const isDeletable = (cert) =>
        cert.status === 'orphaned' || cert.status === 'superseded' || cert.status === 'expired';

    const filterCards = [
        { key: "all", label: t("tls.total"), val: summary.total, sub: t("tls.managedCerts"), color: null },
        { key: "valid", label: t("tls.valid"), val: summary.valid, sub: t("tls.healthy"), color: "var(--accent)" },
        { key: "expiring", label: t("tls.expiring"), val: summary.expiring, sub: t("tls.within14Days"), color: summary.expiring > 0 ? "var(--warn)" : null },
        { key: "expired", label: t("tls.expired"), val: summary.expired, sub: t("tls.needsRenewal"), color: summary.expired > 0 ? "var(--danger)" : null },
    ];

    if (loading) return <div className="loading">{t("tls.loadingCertificates")}</div>;

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
                        <button className="btn btn-ghost tls-refresh--mobile" onClick={load}><UtilityIcon name="refresh" /> {t("common.refresh")}</button>
                        <button className="btn btn-primary" onClick={downloadCA}><UtilityIcon name="arrowDown" /> {t("tls.downloadRootCa")}</button>
                    </div>
                </div>
            </div>

            <div className="grid-4">
                {filterCards.map(({ key, label, val, sub, color }) => (
                    <div
                        key={key}
                        className="card card-clickable"
                        style={{ borderColor: filter === key ? "var(--accent)" : "var(--border)" }}
                        onClick={() => setFilter(key)}
                        onMouseEnter={e => { if (filter !== key) e.currentTarget.style.borderColor = "var(--border2)"; }}
                        onMouseLeave={e => { if (filter !== key) e.currentTarget.style.borderColor = "var(--border)"; }}
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
                        <button className="btn btn-ghost btn--sm tls-refresh--desktop" onClick={load}><UtilityIcon name="refresh" /> {t("common.refresh")}</button>
                    </div>
                </div>
                {sorted.length === 0 ? (
                    <div className="card-empty">
                        {filter === "orphaned" ? t("tls.noOrphaned") : filter === "superseded" ? t("tls.noSuperseded") : t("tls.noCertificates")}
                    </div>
                ) : (
                    <div className="table-wrap">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th className="th-sortable" onClick={() => handleSort("domain")}>{t("tls.domain")} <SortIcon col="domain" /></th>
                                    <th>{t("tls.issuer")}</th>
                                    <th className="th-sortable" onClick={() => handleSort("expires")}>{t("tls.expires")} <SortIcon col="expires" /></th>
                                    <th className="th-sortable" onClick={() => handleSort("days")}>{t("tls.days")} <SortIcon col="days" /></th>
                                    <th>{t("tls.status")}</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((cert, i) => (
                                    <tr key={i} style={{ opacity: cert.status === 'orphaned' || cert.status === 'superseded' ? 0.6 : 1 }}>
                                        <td className="mono">{cert.domain}</td>
                                        <td><span className={`badge ${cert.issuer === 'acme' ? 'badge-blue' : 'badge-muted'}`}>{cert.issuer === 'acme' ? "Let's Encrypt" : t("tls.internal")}</span></td>
                                        <td>
                                            <div className="mono" style={{ fontSize: 12 }}>{formatDate(cert.validTo)}</div>
                                            {expiryBar(cert)}
                                        </td>
                                        <td className="mono" style={{ color: cert.daysRemaining < 0 ? "var(--danger)" : cert.daysRemaining < 14 ? "var(--warn)" : "var(--muted)" }}>
                                            {cert.isInternal ? t("tls.auto") : t("tls.daysShort", { count: cert.daysRemaining })}
                                        </td>
                                        <td>{statusBadge(cert)}</td>
                                        <td className="col-actions-sm">
                                            {isDeletable(cert) && <button className="btn btn-danger btn--icon" onClick={() => deleteCert(cert)} aria-label={t("tls.delete")}><UtilityIcon name="close" /></button>}
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
