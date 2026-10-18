import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authRequest } from "../utils/api.js";

import AuthSetup from './AuthSetup.jsx';
import AuthRecovery from './AuthRecovery.jsx';
import { localizeError } from '../utils/errorMessages.js';

export default function Login({ authState, onLogin, sessionExpired }) {
    const { t } = useTranslation();
    const [recovering, setRecovering] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(sessionExpired ? t("login.sessionExpired") : "");
    const [loading, setLoading] = useState(false);

    const login = async event => {
        event.preventDefault();
        if (!username || !password) return;
        setLoading(true);
        setError("");
        try {
            await authRequest('/sessions', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            setPassword('');
            await onLogin();
        } catch (error) {
            setError(error.code === 'UNAUTHORIZED' ? t('login.failed') : localizeError(error, t));
        } finally {
            setLoading(false);
        }
    };

    if (recovering) return <AuthRecovery onCancel={() => setRecovering(false)} onComplete={async () => { setRecovering(false); await onLogin(); }} />;
    if (authState?.setupRequired && (!authState.enrollmentRequired || authState.enrollmentAuthenticated)) {
        return <AuthSetup enrollment={authState.enrollmentRequired} onComplete={onLogin} />;
    }

    return (
        <div className="login-shell">
            <form className="login-card" onSubmit={login}>
                <div className="login-logo">caddy/ui</div>
                <div className="login-sub">{t("login.serverManager")}</div>
                {authState?.enrollmentRequired && <p className="auth-help">{t('login.legacyHint')}</p>}
                {error && <div className="login-error" role="alert">{error}</div>}
                <div className="field">
                    <label htmlFor="login-username">{t("login.username")}</label>
                    <input id="login-username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
                </div>
                <div className="field">
                    <label htmlFor="login-password">{t("login.password")}</label>
                    <input id="login-password" autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
                </div>
                <button className="btn btn-primary btn--full" type="submit" disabled={loading || !username || !password}>
                    {loading ? t("login.signingIn") : t("login.signIn")}
                </button>
                {!authState?.setupRequired && <button type="button" className="btn btn--full" onClick={() => setRecovering(true)}>{t('login.forgotPassword')}</button>}
            </form>
        </div>
    );
}
