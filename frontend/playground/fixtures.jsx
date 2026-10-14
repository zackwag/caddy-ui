import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../src/components/Confirm.jsx';
import { Toasts, useToast } from '../src/components/Toasts.jsx';
import Dashboard from '../src/components/Dashboard.jsx';
import { apiFetch } from '../src/utils/api.js';
import { localizeError } from '../src/utils/errorMessages.js';

const noop = () => {};

export function RouteConfirmation() {
    const { t } = useTranslation();
    return (
        <ConfirmDialog
            dialog={{
                message: t('routes.deleteConfirm'),
                danger: true,
                confirmLabel: t('common.delete'),
                cancelLabel: t('common.cancel'),
            }}
            resolve={noop}
        />
    );
}

export function CertificateConfirmation() {
    const { t } = useTranslation();
    return (
        <ConfirmDialog
            dialog={{
                message: t('tls.deleteConfirm', { status: 'expired', domain: 'example.home.arpa' }),
                danger: true,
                confirmLabel: t('common.delete'),
                cancelLabel: t('common.cancel'),
            }}
            resolve={noop}
        />
    );
}

export function NotificationToast() {
    const { t } = useTranslation();
    return <Toasts toasts={[{ id: 1, type: 'success', msg: t('notifications.saved') }]} />;
}

function DashboardFixture({ loading }) {
    const [status, setStatus] = useState(null);
    const toast = useToast();
    const { error } = toast;
    const { t } = useTranslation();
    useEffect(() => {
        if (loading) return;
        let cancelled = false;
        apiFetch('/status').then(value => { if (!cancelled) setStatus(value); })
            .catch(e => { if (!cancelled) error(localizeError(e, t), e); });
        return () => { cancelled = true; };
    }, [loading, error, t]);
    return <><Dashboard status={loading ? null : status} toast={toast} onUnauth={noop} /><Toasts toasts={toast.toasts} /></>;
}

export default function FixtureView({ scenario }) {
    switch (scenario.kind) {
        case 'route-confirmation': return <RouteConfirmation />;
        case 'certificate-confirmation': return <CertificateConfirmation />;
        case 'notification-toast': return <NotificationToast />;
        case 'dashboard': return <DashboardFixture loading={scenario.loading} />;
        default: throw new Error(`No renderer for ${scenario.kind}`);
    }
}
