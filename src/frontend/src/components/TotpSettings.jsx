import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { authRequest } from '../utils/api.js';
import { credentialProof, isTotpCode, verificationReady } from '../utils/credentialVerification.js';
import { formatTime } from '../utils/format.js';
import AuthenticatorCode from './AuthenticatorCode.jsx';
import ErrorNote from './ErrorNote.jsx';
import CredentialVerification from './CredentialVerification.jsx';

export default function TotpSettings({ authState, onChange, busy, setBusy, disabled }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState(null);
    const [verification, setVerification] = useState({});
    const [enrollment, setEnrollment] = useState(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!enrollment) {
            return;
        }
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
        try { await authRequest('/totp/setup', { method: 'DELETE' }); clear(); }
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
                await authRequest('/totp/confirm', { method: 'POST', json: { code } });
                clear();
                await onChange();
                setSaved(true);
            } else {
                // eslint-disable-next-line i18next/no-literal-string -- Backend credential-action identifiers.
                const proof = await credentialProof(verification, authState, mode === 'disable' ? 'totp.disable' : 'totp.setup');
                const result = await authRequest(mode === 'disable' ? '/totp' : '/totp/setup', {
                    method: mode === 'disable' ? 'DELETE' : 'POST', json: proof,
                });
                if (mode === 'disable') { clear(); await onChange(); setSaved(true); } else {
                    setEnrollment({ ...result, qr: await QRCode.toDataURL(result.uri, { width: 240, margin: 2 }) });
                }
            }
        } catch (error) {
            setError(error);
            if (error.code === 'TOTP_SETUP_EXPIRED') {
                clear();
            }
        } finally { setVerification({}); setCode(''); setBusy(false); }
    }
    return <fieldset className="security-fields" disabled={disabled || busy || !authState}>
        <p className="modal-hint">{t('totp.hint')}</p>
        {window.location.protocol !== 'https:' && <p className="auth-help">{t('totp.httpWarning')}</p>}
        <p>{t(authState?.totpEnabled ? 'totp.enabled' : 'totp.disabled')}</p>
        <p className="modal-hint">{t('totp.sessionsHint')}</p>
        <ErrorNote error={error} />
        {saved && <p className="security-saved" role="status">{t('totp.saved')}</p>}
        {mode || enrollment ? <form onSubmit={submit}>
            {enrollment ? <>
                <p className="modal-hint">{t('totp.scan')}</p>
                <img className="totp-qr" src={enrollment.qr} alt={t('totp.qrAlt')} width={240} height={240} />
                <div className="field"><label htmlFor="totp-secret">{t('totp.manualKey')}</label>
                    <input id="totp-secret" readOnly autoComplete="off" spellCheck={false} value={enrollment.secret} /></div>
                <p className="modal-hint">{t('totp.expires', { time: formatTime(enrollment.expiresAt) })}</p>
                <AuthenticatorCode id="totp-confirm-code" value={code} onChange={setCode} autoFocus />
            </> : <>
                {mode === 'disable' && <p className="auth-help">{t('totp.disableHint')}</p>}
                <CredentialVerification value={verification} setValue={setVerification} authState={authState} passwordId="totp-current-password" />
            </>}
            <div className="btn-row">
                <button className="btn btn-primary" disabled={enrollment ? !isTotpCode(code) : !verificationReady(verification, authState)}>
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
