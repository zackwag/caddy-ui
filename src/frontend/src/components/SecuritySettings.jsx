import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ActivityLog from './ActivityLog.jsx';
import ApiTokens from './ApiTokens.jsx';
import UserSettings from './UserSettings.jsx';
import TotpSettings from './TotpSettings.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { localizeError } from '../utils/errorMessages.js';
import Passkeys from './Passkeys.jsx';
import { UtilityIcon } from './Icons.jsx';

function Section({ id, title, open, onToggle, disabled, nested = false, className = '', children }) {
    /* eslint-disable i18next/no-literal-string -- Element and class names. */
    const Heading = nested ? 'h4' : 'h3';
    const name = nested ? 'security-subsection' : 'security-section';
    /* eslint-enable i18next/no-literal-string */
    return <section className={name}>
        <Heading><button type="button" className="security-toggle" aria-expanded={open} aria-controls={`security-${id}`} disabled={disabled} onClick={onToggle}>
            <span>{title}</span><UtilityIcon name="chevronDown" />
        </button></Heading>
        <div id={`security-${id}`} className={`${name}-body ${className}`} hidden={!open}>{children}</div>
    </section>;
}

export default function SecuritySettings({ instances, instancesError, onClose }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const dialog = useRef(null);
    const { data: authState, error, reload: refreshAuth } = useFetch('/auth/status');
    const [open, setOpen] = useState({});
    const [authBusy, setAuthBusy] = useState(false);
    const [userBusy, setUserBusy] = useState(false);
    const [tokenBusy, setTokenBusy] = useState(false);
    const [issued, setIssued] = useState(null);
    const locked = userBusy || tokenBusy || authBusy || !!issued;

    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);

    const securitySection = (id, title, subsections = []) => ({
        id, title, disabled: locked, open: !!open[id],
        onToggle: () => setOpen(previous => ({ ...previous, [id]: !previous[id], ...Object.fromEntries(subsections.map(name => [name, false])) })),
    });

    return <dialog ref={dialog} className="modal security-dialog" aria-labelledby="security-title"
        onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
        <h2 className="modal-title" id="security-title">{t('security.title')}</h2>
        {error && <div role="alert"><p>{localizeError(error, t)}</p>
            <button type="button" className="btn" disabled={locked} onClick={refreshAuth}>{t('login.retry')}</button></div>}
        <Section {...securitySection('user', t('security.user'))}>
            <UserSettings authState={authState} busy={userBusy} setBusy={setUserBusy} disabled={tokenBusy || authBusy || !!issued} />
        </Section>
        <Section {...securitySection('auth', t('security.auth'), ['totp', 'passkeys'])} className="security-auth-sections">
            <Section nested {...securitySection('totp', t('totp.title'))}>
                {open.totp && <TotpSettings authState={authState} onChange={refreshAuth}
                    busy={authBusy} setBusy={setAuthBusy} disabled={userBusy || tokenBusy || !!issued} />}
            </Section>
            <Section nested {...securitySection('passkeys', t('passkeys.title'))}>
                {open.passkeys && <Passkeys authState={authState} onChange={refreshAuth}
                    busy={authBusy} setBusy={setAuthBusy} disabled={userBusy || tokenBusy || !!issued}
                    onOpenTls={() => { onClose(); navigate('/tls'); }} />}
            </Section>
        </Section>
        <Section {...securitySection('tokens', t('apiTokens.title'))}>
            <ApiTokens instances={instances} instancesError={instancesError} busy={tokenBusy} setBusy={setTokenBusy} issued={issued} setIssued={setIssued} disabled={userBusy || authBusy} />
        </Section>
        <Section {...securitySection('activity', t('activity.title'))}>
            {open.activity && <ActivityLog />}
        </Section>
        <div className="btn-row flex-end"><button type="button" className="btn btn-ghost" disabled={locked} onClick={onClose}>{t('common.close')}</button></div>
    </dialog>;
}
