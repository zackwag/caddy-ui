import React from 'react';
import { createRoot } from 'react-dom/client';
import Workbench from './Workbench.jsx';
import { createPreviewI18n } from './model.js';
import { css, THEME_LIST } from '../src/styles.js';
import './workbench.css';

const modules = import.meta.glob('../src/i18n/locales/*.js', { eager: true, import: 'default' });
const catalogs = Object.fromEntries(
    Object.entries(modules).map(([path, catalog]) => [path.split('/').pop().slice(0, -3), catalog]),
);
const preview = await createPreviewI18n(catalogs, 'de' in catalogs ? 'de' : 'en');
const palette = THEME_LIST.find((theme) => theme.id === 'vt2026');
for (const [key, value] of Object.entries(palette.vars))
    document.documentElement.style.setProperty(key, value);
const style = document.createElement('style');
style.textContent = css;
document.head.prepend(style);
createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <Workbench catalogs={catalogs} preview={preview} />
    </React.StrictMode>,
);
