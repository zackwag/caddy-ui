import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { authRequest } from '../utils/api.js';
import { credentialProof, verificationReady } from '../utils/credentialVerification.js';
import { localizeError } from '../utils/errorMessages.js';
import AuthenticatorCode from './AuthenticatorCode.jsx';
import CredentialVerification from './CredentialVerification.jsx';

export default function TotpSettings({ authState, onChange, onUnauth, busy, setBusy, disabled }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState(null);
    const [verification, setVerification] = useState({});
    const [enrollment, setEnrollment] = useState(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!enrollment) return;
        const timer = setTimeout(() => {
            setEnrollment(null);
            setCode('');
            setMode(null);
            // eslint-disable-next-line i18next/no-literal-string -- Backend error code, localized below.
            setError({ code: 'TOTP_SETUP_EXPIRED' });
        }, Math.max(0, Date.parse(enrollment.expiresAt) - Date.now()));
        return () => clearTimeout(timer);
    }, [enrollment]);

    function clear() { setEnrollment(null); setCode(''); setVerification({}); setMode(null); }
    async function cancel() {
        setBusy(true);
        setError(null);
        try { await authRequest('/totp/setup', { method: 'DELETE' }, onUnauth); clear(); }
        catch (error) { setError(error); }
        finally { setBusy(false); }
    }
    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            if (enrollment) {
                await authRequest('/totp/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }, onUnauth);
                clear();
                await onChange();
                setSaved(true);
            } else {
                // eslint-disable-next-line i18next/no-literal-string -- Backend credential-action identifiers.
                const proof = await credentialProof(verification, authState, mode === 'disable' ? 'totp.disable' : 'totp.setup', onUnauth);
                const result = await authRequest(mode === 'disable' ? '/totp' : '/totp/setup', {
                    method: mode === 'disable' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proof),
                }, onUnauth);
                if (mode === 'disable') { clear(); await onChange(); setSaved(true); }
                else setEnrollment({ ...result, qr: await QRCode.toDataURL(result.uri, { width: 240, margin: 2 }) });
            }
        } catch (error) {
            setError(error);
            if (error.code === 'TOTP_SETUP_EXPIRED') clear();
        } finally { setVerification({}); setCode(''); setBusy(false); }
    }
    return <fieldset className="security-fields" disabled={disabled || busy || !authState}>
        <p className="modal-hint">{t('totp.hint')}</p>
        {window.location.protocol !== 'https:' && <p className="auth-help">{t('totp.httpWarning')}</p>}
        <p>{t(authState?.totpEnabled ? 'totp.enabled' : 'totp.disabled')}</p>
        <p className="modal-hint">{t('totp.sessionsHint')}</p>
        {error && <p className="login-error" role="alert">{localizeError(error, t)}</p>}
        {saved && <p className="security-saved" role="status">{t('totp.saved')}</p>}
        {mode || enrollment ? <form onSubmit={submit}>
            {enrollment ? <>
                <p className="modal-hint">{t('totp.scan')}</p>
                <img className="totp-qr" src={enrollment.qr} alt={t('totp.qrAlt')} width={240} height={240} />
                <div className="field"><label htmlFor="totp-secret">{t('totp.manualKey')}</label>
                    <input id="totp-secret" readOnly autoComplete="off" spellCheck={false} value={enrollment.secret} /></div>
                <p className="modal-hint">{t('totp.expires', { time: new Date(enrollment.expiresAt).toLocaleTimeString() })}</p>
                <AuthenticatorCode id="totp-confirm-code" value={code} onChange={setCode} autoFocus />
            </> : <>
                {mode === 'disable' && <p className="auth-help">{t('totp.disableHint')}</p>}
                <CredentialVerification value={verification} setValue={setVerification} authState={authState} passwordId="totp-current-password" />
            </>}
            <div className="btn-row">
                <button className="btn btn-primary" disabled={enrollment ? !/^\d{6}$/.test(code) : !verificationReady(verification, authState)}>
                    {t(enrollment ? 'totp.confirm' : mode === 'disable' ? 'totp.disable' : 'totp.setup')}
                </button>
                <button className="btn" type="button" onClick={cancel}>{t('common.cancel')}</button>
            </div>
        </form> : <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => { setMode('setup'); setError(null); setSaved(false); }}>{t(authState?.totpEnabled ? 'totp.replace' : 'totp.setup')}</button>
            {authState?.totpEnabled && <button type="button" className="btn btn-danger" onClick={() => { setMode('disable'); setError(null); setSaved(false); }}>{t('totp.disable')}</button>}
        </div>}
    </fieldset>;
}
