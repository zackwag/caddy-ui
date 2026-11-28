import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authRequest } from '../utils/api.js';
import ErrorNote from './ErrorNote.jsx';
import LoginCard, { LoginLogo } from './LoginCard.jsx';
import NewPassword from './NewPassword.jsx';
import { requireMatchingPasswords } from '../utils/credentialVerification.js';

export function RecoveryKey({ value, onComplete }) {
    const { t } = useTranslation();
    const [saved, setSaved] = useState(false);
    return <LoginCard>
        <LoginLogo />
        <h1 className="login-sub">{t('login.saveRecoveryKey')}</h1>
        <p className="auth-help">{t('login.recoveryKeyHint')}</p>
        <div className="field"><label htmlFor="new-recovery-key">{t('login.recoveryKey')}</label>
            <textarea id="new-recovery-key" className="auth-recovery-key" readOnly value={value} rows={3} spellCheck={false} /></div>
        <label className="auth-ack"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />{t('login.savedRecoveryKey')}</label>
        <button className="btn btn-primary btn--full" disabled={!saved} onClick={onComplete}>{t('login.continue')}</button>
    </LoginCard>;
}

export default function AuthRecovery({ onComplete, onCancel }) {
    const { t } = useTranslation();
    const [key, setKey] = useState('');
    const [newPassword, setNewPassword] = useState({});
    const [replacement, setReplacement] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const submitRecovery = async event => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        try {
            requireMatchingPasswords(newPassword);
            const result = await authRequest('/recovery', { method: 'POST', json: { recoveryKey: key, password: newPassword.password } });
            setKey('');
            setNewPassword({});
            setReplacement(result.recoveryKey);
        } catch (error) { setError(error); }
        finally { setLoading(false); }
    };

    if (replacement) {
        return <RecoveryKey value={replacement} onComplete={onComplete} />;
    }
    return <LoginCard onSubmit={submitRecovery}>
        <LoginLogo />
        <h1 className="login-sub">{t('login.recoveryTitle')}</h1>
        <p className="auth-help">{t('login.recoveryHint')}</p>
        <ErrorNote error={error} />
        <div className="field"><label htmlFor="recovery-key">{t('login.recoveryKey')}</label>
            <input id="recovery-key" value={key} onChange={e => setKey(e.target.value)} required autoComplete="off" autoFocus /></div>
        <NewPassword id="recovery" label={t('login.password')} value={newPassword} onChange={setNewPassword} />
        <button className="btn btn-primary btn--full" disabled={loading}>{t(loading ? 'login.saving' : 'login.resetPassword')}</button>
        <button type="button" className="btn btn--full" onClick={onCancel}>{t('login.backToLogin')}</button>
    </LoginCard>;
}
