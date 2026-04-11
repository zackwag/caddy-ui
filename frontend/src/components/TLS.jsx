import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../utils/api.js";

export default function TLS({ toast, onUnauth }) {
    const [certs, setCerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [sortCol, setSortCol] = useState("domain");
    const [sortDir, setSortDir] = useState("asc");

    const load = () => {
        setLoading(true);
        apiFetch("/tls", {}, onUnauth).then(setCerts).catch(e => toast.error(e.message)).finally(() => setLoading(false));
    };

    useEffect(load, []);

    const deleteCert = async (cert) => {
        if (!confirm(`Delete orphaned cert for ${cert.domain}?`)) return;
        try {
            await apiFetch(`/tls/${cert.domain}`, { method: "DELETE" }, onUnauth);
            toast.success(`Deleted cert for ${cert.domain}`); load();
        } catch (e) { toast.error(e.message); }
    };

    const downloadCA = () => {
        const token = getToken();
        window.open(token ? `/api/tls/ca?token=${token}` : `/api/tls/ca`, '_blank');
    };

    const summary = {
        total: certs.filter(c => c.status !== 'orphaned').length,
        valid: certs.filter(c => c.status === 'valid').length,
        expiring: certs.filter(c => c.status === 'expiring').length,
        expired: certs.filter(c => c.status === 'expired').length,
        orphaned: certs.filter(c => c.status === 'orphaned').length,
    };

    const filtered = filter === "all" ? certs.filter(c => c.status !== 'orphaned') : certs.filter(c => c.status === filter);

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSortCol(col); setSortDir("asc"); }
    };

    const sorted = [...filtered].sort((a, b) => {
        let valA, valB;
        if (sortCol === "domain") { valA = a.domain; valB = b.domain; }
        else if (sortCol === "expires") { valA = new Date(a.validTo).getTime(); valB = new Date(b.validTo).getTime(); return sortDir === "asc" ? valA - valB : valB - valA; }
        else if (sortCol === "days") { valA = a.isInternal ? Infinity : a.daysRemaining; valB = b.isInternal ? Infinity : b.daysRemaining; return sortDir === "asc" ? valA - valB : valB - valA; }
        else { valA = a.domain; valB = b.domain; }
        return sortDir === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    const SortIcon = ({ col }) => {
        if (sortCol !== col) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
        return <span style={{ marginLeft: 4, color: "var(--accent)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
    };

    const statusBadge = (cert) => {
        if (cert.status === 'expired') return <span className="badge badge-red">EXPIRED</span>;
        if (cert.status === 'expiring') return <span className="badge badge-yellow">EXPIRING</span>;
        if (cert.status === 'orphaned') return <span className="badge badge-muted">ORPHANED</span>;
        return <span className="badge badge-green">VALID</span>;
    };

    const expiryBar = (cert) => {
        if (cert.isInternal) return null;
        const pct = Math.max(0, Math.min(100, (cert.daysRemaining / 90) * 100));
        const color = cert.daysRemaining < 0 ? 'var(--danger)' : cert.daysRemaining < 14 ? 'var(--warn)' : 'var(--accent)';
        return <div className="expiry-bar"><div className="expiry-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>;
    };

    const formatDate = (dateStr) => {
        try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
        catch { return dateStr; }
    };

    const filterCards = [
        { key: "all", label: "Total", val: summary.total, sub: "Managed certs", color: null },
        { key: "valid", label: "Valid", val: summary.valid, sub: "Healthy", color: "var(--accent)" },
        { key: "expiring", label: "Expiring", val: summary.expiring, sub: "Within 14 days", color: summary.expiring > 0 ? "var(--warn)" : null },
        { key: "expired", label: "Expired", val: summary.expired, sub: "Needs renewal", color: summary.expired > 0 ? "var(--danger)" : null },
    ];

    if (loading) return <div style={{ color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading certificates...</div>;

    return (
        <div className="gap-16">
            <div className="card">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                    <div>
                        <div className="card-title" style={{ marginBottom: 4 }}>Root CA Certificate</div>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--muted)", maxWidth: 480 }}>
                            Install this on your devices to trust internal TLD domains (e.g. <span style={{ color: "var(--accent)" }}>.internal</span>, <span style={{ color: "var(--accent)" }}>.home</span>) served by Caddy's built-in CA. Required after a fresh Caddy install or server rebuild.
                        </div>
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
                            {[
                                { os: "iOS / iPadOS", instruction: "Open the file → Settings → Profile Downloaded → Install" },
                                { os: "macOS", instruction: "Open Keychain Access → drag in cert → set to Always Trust" },
                                { os: "Android", instruction: "Settings → Security → Install from storage" },
                                { os: "Windows", instruction: "Double-click cert → Install Certificate → Trusted Root CAs" },
                            ].map(({ os, instruction }) => (
                                <div key={os} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--muted)" }}>
                                    <span style={{ color: "var(--text)" }}>{os}</span> — {instruction}
                                </div>
                            ))}
                        </div>
                    </div>
                    <button className="btn btn-primary" onClick={downloadCA} style={{ flexShrink: 0 }}>↓ Download Root CA</button>
                </div>
            </div>

            <div className="grid-4">
                {filterCards.map(({ key, label, val, sub, color }) => (
                    <div
                        key={key}
                        className="card"
                        style={{ cursor: "pointer", borderColor: filter === key ? "var(--accent)" : "var(--border)", transition: "border-color 0.15s, background 0.15s" }}
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

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--muted)" }}>
                        Certificates {filter !== "all" && `— ${filter}`}
                    </span>
                    <div className="btn-row">
                        {summary.orphaned > 0 && (
                            <span
                                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: filter === "orphaned" ? "var(--accent)" : "var(--muted)", cursor: "pointer" }}
                                onClick={() => setFilter(filter === "orphaned" ? "all" : "orphaned")}
                            >
                                {summary.orphaned} orphaned
                            </span>
                        )}
                        <button className="btn btn-ghost" onClick={load} style={{ fontSize: 11 }}>↺ Refresh</button>
                    </div>
                </div>
                {sorted.length === 0 ? (
                    <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                        {filter === "orphaned"
                            ? "No orphaned certificates"
                            : "No certificates in this category"}
                    </div>
                ) : (
                    <div className="table-wrap">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th onClick={() => handleSort("domain")} style={{ cursor: "pointer", userSelect: "none" }}>Domain <SortIcon col="domain" /></th>
                                    <th>Issuer</th>
                                    <th onClick={() => handleSort("expires")} style={{ cursor: "pointer", userSelect: "none" }}>Expires <SortIcon col="expires" /></th>
                                    <th onClick={() => handleSort("days")} style={{ cursor: "pointer", userSelect: "none" }}>Days <SortIcon col="days" /></th>
                                    <th>Status</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((cert, i) => (
                                    <tr key={i} style={{ opacity: cert.status === 'orphaned' ? 0.6 : 1 }}>
                                        <td className="mono">{cert.domain}</td>
                                        <td><span className={`badge ${cert.issuer === 'acme' ? 'badge-blue' : 'badge-muted'}`}>{cert.issuer === 'acme' ? "Let's Encrypt" : "Internal"}</span></td>
                                        <td>
                                            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>{formatDate(cert.validTo)}</div>
                                            {expiryBar(cert)}
                                        </td>
                                        <td className="mono" style={{ color: cert.daysRemaining < 0 ? "var(--danger)" : cert.daysRemaining < 14 ? "var(--warn)" : "var(--muted)" }}>
                                            {cert.isInternal ? "auto" : `${cert.daysRemaining}d`}
                                        </td>
                                        <td>{statusBadge(cert)}</td>
                                        <td style={{ width: 60, textAlign: "right" }}>
                                            {cert.status === 'orphaned' && <button className="btn btn-danger" style={{ padding: "4px 10px" }} onClick={() => deleteCert(cert)}>✕</button>}
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
