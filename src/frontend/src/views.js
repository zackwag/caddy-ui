// Every page: where it is, what it's called and whether it's about the selected
// instance. The rest stay reachable while no instance is configured.
export const VIEWS = [
    { path: '/dashboard', icon: 'dashboard', titleKey: 'pages.dashboard', navKey: 'sidebar.nav.dashboard', needsInstance: true },
    { path: '/routes', icon: 'routes', titleKey: 'pages.routes', navKey: 'sidebar.nav.routes', needsInstance: true },
    { path: '/caddyfile', icon: 'caddyfile', titleKey: 'pages.caddyfile', navKey: 'sidebar.nav.caddyfile', needsInstance: true },
    { path: '/tls', icon: 'tls', titleKey: 'pages.tls', navKey: 'sidebar.nav.tls', needsInstance: true },
    { path: '/logs', icon: 'logs', titleKey: 'pages.logs', navKey: 'sidebar.nav.logs', needsInstance: false },
    { path: '/metrics', icon: 'metrics', titleKey: 'pages.metrics', navKey: 'sidebar.nav.metrics', needsInstance: true },
    { path: '/notifications', icon: 'notifications', titleKey: 'pages.notifications', navKey: 'sidebar.nav.notifications', needsInstance: false },
    { path: '/instances', icon: 'instances', titleKey: 'pages.instances', navKey: 'sidebar.nav.instances', needsInstance: false },
];

export function viewAt(pathname) {
    const path = '/' + pathname.split('/')[1];
    return VIEWS.find(view => view.path === path) || VIEWS[0];
}
