import { useTranslation } from 'react-i18next';

// A new password and its confirmation. `value` is { password, confirmation };
// both inputs are named after `id`. `hint` precedes the password rules.
export default function NewPassword({ id, value, onChange, label, hint, required = true }) {
    const { t } = useTranslation();
    const { password = '', confirmation = '' } = value;
    return <>
        <div className="field"><label htmlFor={`${id}-password`}>{label}</label>
            <input id={`${id}-password`} type="password" autoComplete="new-password" required={required} minLength={12} maxLength={1024}
                aria-describedby={`${id}-password-hint`} value={password} onChange={event => onChange({ ...value, password: event.target.value })} /></div>
        <p id={`${id}-password-hint`} className={hint ? 'modal-hint' : 'auth-help'}>{hint}{hint && ' '}{t('login.passwordHint')}</p>
        <div className="field"><label htmlFor={`${id}-confirm`}>{t('login.confirmPassword')}</label>
            <input id={`${id}-confirm`} type="password" autoComplete="new-password" required={required || !!password}
                value={confirmation} onChange={event => onChange({ ...value, confirmation: event.target.value })} /></div>
    </>;
}
