import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authRequest } from '../utils/api.js';
import { localizeError } from '../utils/errorMessages.js';

export function RecoveryKey({ value, onComplete }) {
    const { t } = useTranslation();
    const [saved, setSaved] = useState(false);
    return <div className="login-shell"><div className="login-card">
        <div className="login-logo">caddy/ui</div>
        <h1 className="login-sub">{t('login.saveRecoveryKey')}</h1>
        <p className="auth-help">{t('login.recoveryKeyHint')}</p>
        <div className="field"><label htmlFor="new-recovery-key">{t('login.recoveryKey')}</label>
            <textarea id="new-recovery-key" className="auth-recovery-key" readOnly value={value} rows={3} spellCheck={false} /></div>
        <label className="auth-ack"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />{t('login.savedRecoveryKey')}</label>
        <button className="btn btn-primary btn--full" disabled={!saved} onClick={onComplete}>{t('login.continue')}</button>
    </div></div>;
}

export default function AuthRecovery({ onComplete, onCancel }) {
    const { t } = useTranslation();
    const [key, setKey] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [replacement, setReplacement] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const submitRecovery = async event => {
        event.preventDefault();
        if (password !== confirmation) { setError(t('login.passwordMismatch')); return; }
        setLoading(true);
        setError('');
        try {
            const result = await authRequest('/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoveryKey: key, password }) });
            setKey('');
            setPassword('');
            setConfirmation('');
            setReplacement(result.recoveryKey);
        } catch (error) { setError(localizeError(error, t)); }
        finally { setLoading(false); }
    };

    if (replacement) return <RecoveryKey value={replacement} onComplete={onComplete} />;
    return <div className="login-shell"><form className="login-card" onSubmit={submitRecovery}>
        <div className="login-logo">caddy/ui</div>
        <h1 className="login-sub">{t('login.recoveryTitle')}</h1>
        <p className="auth-help">{t('login.recoveryHint')}</p>
        {error && <div className="login-error" role="alert">{error}</div>}
        <div className="field"><label htmlFor="recovery-key">{t('login.recoveryKey')}</label>
            <input id="recovery-key" value={key} onChange={e => setKey(e.target.value)} required autoComplete="off" autoFocus /></div>
        <div className="field"><label htmlFor="recovery-password">{t('login.password')}</label>
            <input id="recovery-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={1024} autoComplete="new-password" /></div>
        <p className="auth-help">{t('login.passwordHint')}</p>
        <div className="field"><label htmlFor="recovery-confirm">{t('login.confirmPassword')}</label>
            <input id="recovery-confirm" type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required autoComplete="new-password" /></div>
        <button className="btn btn-primary btn--full" disabled={loading}>{t(loading ? 'login.saving' : 'login.resetPassword')}</button>
        <button type="button" className="btn btn--full" onClick={onCancel}>{t('login.backToLogin')}</button>
    </form></div>;
}
