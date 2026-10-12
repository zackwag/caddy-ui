# Project Structure

## Project Structure

```text
caddy-ui/
├── backend/
│   ├── src/
│   │   ├── index.js
│   │   ├── caddy.js
│   │   ├── caddyfileTitles.js
│   │   ├── containerFs.js         ← docker exec wrapper for file ops inside Caddy containers
│   │   ├── docker.js
│   │   ├── dockerDiscovery.js     ← auto-discover Caddy containers via Docker socket
│   │   ├── instances.js
│   │   ├── logger.js
│   │   ├── notifications.js
│   │   ├── settings.js
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   └── instance.js
│   │   └── routes/
│   │       ├── auth.js
│   │       ├── caddyfile.js
│   │       ├── health.js
│   │       ├── instances.js
│   │       ├── logs.js
│   │       ├── metrics.js
│   │       ├── notifications.js
│   │       ├── routenotes.js
│   │       ├── routes.js
│   │       ├── servernames.js
│   │       ├── settings.js
│   │       ├── status.js
│   │       └── tls.js
│   ├── Dockerfile
│   ├── DOCKERHUB.md
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CaddyFile.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Instances.jsx      ← instance management page with discovery
│   │   │   ├── Login.jsx
│   │   │   ├── Logs.jsx
│   │   │   ├── Metrics.jsx
│   │   │   ├── Notifications.jsx
│   │   │   ├── Routes.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   ├── ThemePicker.jsx
│   │   │   ├── ThemeWelcome.jsx
│   │   │   ├── TLS.jsx
│   │   │   └── Toasts.jsx
│   │   ├── hooks/
│   │   │   ├── useClickOutside.js
│   │   │   └── useInstanceStatus.js
│   │   ├── utils/
│   │   │   ├── api.js
│   │   │   └── format.js
│   │   ├── lib/
│   │   │   └── caddyfileMode.js  (fetched at build time, gitignored)
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.js
│   ├── scripts/
│   │   └── fetch-caddyfile-mode.mjs
│   ├── Dockerfile
│   ├── DOCKERHUB.md
│   ├── nginx.conf
│   ├── vite.config.js
│   ├── index.html
│   └── package.json
├── .github/
│   └── workflows/
│       ├── beta.yml
│       └── release.yml
└── README.md
```
