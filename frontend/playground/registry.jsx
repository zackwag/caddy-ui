import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../src/components/Confirm.jsx';
import { Toasts } from '../src/components/Toasts.jsx';

function RouteConfirmation() {
    const { t } = useTranslation();
    return <ConfirmDialog dialog={{ message: t('routes.deleteConfirm'), danger: true,
        confirmLabel: t('common.delete'), cancelLabel: t('common.cancel') }} resolve={() => {}} />;
}

function CertificateConfirmation() {
    const { t } = useTranslation();
    return <ConfirmDialog dialog={{ message: t('tls.deleteConfirm', { status: 'expired', domain: 'example.home.arpa' }), danger: true,
        confirmLabel: t('common.delete'), cancelLabel: t('common.cancel') }} resolve={() => {}} />;
}

function NotificationToast() {
    const { t } = useTranslation();
    return <Toasts toasts={[{ id: 1, type: 'success', msg: t('notifications.saved') }]} />;
}

// Register UI states, listing every key they render. Keep fixtures free of API calls.
export const scenarios = [
    { id: 'route-delete', title: 'Route deletion', keys: ['routes.deleteConfirm', 'common.delete', 'common.cancel'], Component: RouteConfirmation },
    { id: 'certificate-delete', title: 'Certificate deletion (interpolation)', keys: ['tls.deleteConfirm', 'common.delete', 'common.cancel'], Component: CertificateConfirmation },
    { id: 'notification-saved', title: 'Notification settings saved', keys: ['notifications.saved'], Component: NotificationToast },
];
