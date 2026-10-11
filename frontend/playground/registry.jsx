import { RouteConfirmation, CertificateConfirmation, NotificationToast } from './fixtures.jsx';

// Register UI states, listing every key they render. Keep fixtures free of API calls.
export const scenarios = [
    { id: 'route-delete', title: 'Route deletion', keys: ['routes.deleteConfirm', 'common.delete', 'common.cancel'], Component: RouteConfirmation },
    { id: 'certificate-delete', title: 'Certificate deletion (interpolation)', keys: ['tls.deleteConfirm', 'common.delete', 'common.cancel'], Component: CertificateConfirmation },
    { id: 'notification-saved', title: 'Notification settings saved', keys: ['notifications.saved'], Component: NotificationToast },
];
