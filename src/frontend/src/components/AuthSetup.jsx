import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authRequest } from '../utils/api.js';
import ErrorNote from './ErrorNote.jsx';
import LoginCard, { LoginLogo } from './LoginCard.jsx';
import NewPassword from './NewPassword.jsx';
import { requireMatchingPasswords } from '../utils/credentialVerification.js';
import { RecoveryKey } from './AuthRecovery.jsx';

export default function AuthSetup({ enrollment, onComplete }) {
    const { t } = useTranslation();
    const [username, setUsername] = useState('');
    const [newPassword, setNewPassword] = useState({});
    const [recoveryKey, setRecoveryKey] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const submitSetup = async event => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        try {
            requireMatchingPasswords(newPassword);
            const result = await authRequest('/setup', { method: 'POST', json: { username, password: newPassword.password } });
            setRecoveryKey(result.recoveryKey);
        } catch (error) { setError(error); }
        finally { setLoading(false); }
    };

    if (recoveryKey) return <RecoveryKey value={recoveryKey} onComplete={onComplete} />;
    return <LoginCard onSubmit={submitSetup}>
        <LoginLogo />
        <h1 className="login-sub">{t('login.setupTitle')}</h1>
        <p className="auth-help">{t(enrollment ? 'login.enrollmentHint' : 'login.setupHint')}</p>
        <ErrorNote error={error} />
        <div className="field"><label htmlFor="setup-username">{t('login.username')}</label>
            <input id="setup-username" value={username} onChange={e => setUsername(e.target.value)} required maxLength={128} autoComplete="username" autoFocus /></div>
        <NewPassword id="setup" label={t('login.password')} value={newPassword} onChange={setNewPassword} />
        <button className="btn btn-primary btn--full" disabled={loading}>{t(loading ? 'login.saving' : 'login.completeSetup')}</button>
    </LoginCard>;
}
