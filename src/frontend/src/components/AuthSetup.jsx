import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authRequest } from '../utils/api.js';
import { localizeError } from '../utils/errorMessages.js';
import { RecoveryKey } from './AuthRecovery.jsx';

export default function AuthSetup({ enrollment, onComplete }) {
    const { t } = useTranslation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [recoveryKey, setRecoveryKey] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const submitSetup = async event => {
        event.preventDefault();
        if (password !== confirmation) { setError(t('login.passwordMismatch')); return; }
        setLoading(true);
        setError('');
        try {
            const result = await authRequest('/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            setRecoveryKey(result.recoveryKey);
        } catch (error) { setError(localizeError(error, t)); }
        finally { setLoading(false); }
    };

    if (recoveryKey) return <RecoveryKey value={recoveryKey} onComplete={onComplete} />;
    return <div className="login-shell"><form className="login-card" onSubmit={submitSetup}>
        <div className="login-logo">caddy/ui</div>
        <h1 className="login-sub">{t('login.setupTitle')}</h1>
        <p className="auth-help">{t(enrollment ? 'login.enrollmentHint' : 'login.setupHint')}</p>
        {error && <div className="login-error" role="alert">{error}</div>}
        <div className="field"><label htmlFor="setup-username">{t('login.username')}</label>
            <input id="setup-username" value={username} onChange={e => setUsername(e.target.value)} required maxLength={128} autoComplete="username" autoFocus /></div>
        <div className="field"><label htmlFor="setup-password">{t('login.password')}</label>
            <input id="setup-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={1024} autoComplete="new-password" aria-describedby="password-hint" /></div>
        <p id="password-hint" className="auth-help">{t('login.passwordHint')}</p>
        <div className="field"><label htmlFor="setup-confirm">{t('login.confirmPassword')}</label>
            <input id="setup-confirm" type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required autoComplete="new-password" /></div>
        <button className="btn btn-primary btn--full" disabled={loading}>{t(loading ? 'login.saving' : 'login.completeSetup')}</button>
    </form></div>;
}
