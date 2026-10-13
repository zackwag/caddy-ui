import { useState } from "react";
import { useTranslation } from "react-i18next";
import { API, setToken } from "../utils/api.js";

export default function Login({ onLogin, sessionExpired }) {
    const { t } = useTranslation();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(sessionExpired ? t("login.sessionExpired") : "");
    const [loading, setLoading] = useState(false);

    const login = async () => {
        if (!username || !password) return;
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`${API}/auth/sessions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            if (!res.ok) { setError(t("login.failed")); return; }
            setToken(data.token);
            onLogin();
        } catch {
            setError(t("login.serverUnreachable"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-shell">
            <div className="login-card">
                <div className="login-logo">caddy/ui</div>
                <div className="login-sub">{t("login.serverManager")}</div>
                {error && <div className="login-error">{error}</div>}
                <div className="field">
                    <label>{t("login.username")}</label>
                    <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} autoFocus autoComplete="username" />
                </div>
                <div className="field">
                    <label>{t("login.password")}</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} autoComplete="current-password" />
                </div>
                <button className="btn btn-primary btn--full" onClick={login} disabled={loading || !username || !password}>
                    {loading ? t("login.signingIn") : t("login.signIn")}
                </button>
            </div>
        </div>
    );
}
