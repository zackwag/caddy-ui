import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authRequest } from '../utils/api.js';
import { localizeError } from '../utils/errorMessages.js';
import AuthenticatorCode from './AuthenticatorCode.jsx';

export default function TotpLogin({ onLogin, onCancel }) {
    const { t } = useTranslation();
    const [code, setCode] = useState('');
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await authRequest('/sessions/totp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
            await onLogin();
        } catch (error) { setError(error); }
        finally { setCode(''); setBusy(false); }
    }
    async function cancel() {
        setBusy(true);
        try { await authRequest('/sessions/current', { method: 'DELETE' }); onCancel(); }
        catch (error) { setError(error); }
        finally { setBusy(false); }
    }
    return <div className="login-shell"><form className="login-card" onSubmit={submit}>
        <h2>{t('totp.loginTitle')}</h2>
        <p className="auth-help">{t('totp.loginHint')}</p>
        {error && <p className="login-error" role="alert">{localizeError(error, t)}</p>}
        <fieldset className="security-fields" disabled={busy || error?.code === 'TOTP_CHALLENGE_EXPIRED' || error?.code === 'TOTP_RATE_LIMITED'}>
            <AuthenticatorCode id="login-totp" value={code} onChange={setCode} autoFocus />
            <button className="btn btn-primary btn--full" disabled={!/^\d{6}$/.test(code)}>{t(busy ? 'login.signingIn' : 'totp.verify')}</button>
        </fieldset>
        <button type="button" className="btn btn--full" disabled={busy} onClick={cancel}>{t('totp.backToLogin')}</button>
    </form></div>;
}
