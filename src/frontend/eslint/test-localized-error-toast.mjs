import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import rule from './localized-error-toast.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
});

const invalid = [
    'toast.error(error.message);',
    'toastRef.current.error(error.message);',
    'toast.error(response.error);',
    'toast.error(response.errors.join("\\n"));',
    'toast.error("Something failed");',
    'toast.error(`Failed: ${error.message}`);',
    'const message = error.message; toast.error(message);',
    'toast.error(error.message || t("errors.generic"));',
    'toast.error(ok ? t("errors.generic") : error.message);',
    'toast.error(t(error.message));',
    'toast.error(t(""));',
    'toast.error();',
    'toast.error(...messages);',
    'toast["error"](error.message);',
    'toastRef["current"]["error"](error.message);',
    'toast?.error(error.message);',
    'toastRef.current?.error(error.message);',
    'toast.error(localizeError(error));',
];

tester.run('localized-error-toast', rule, {
    valid: [
        'toast.error(t("errors.generic"));',
        'toastRef.current.error(t("errors.loadFailed"));',
        'toast.error(localizeError(error, t));',
        'toastRef.current.error(localizeError(error, t));',
        'toast.error(ok ? t("errors.first") : t("errors.second"));',
        'toast.error(t("errors.first") || t("errors.generic"));',
        'toast["error"](t("errors.generic"));',
        'toast?.error(t("errors.generic"));',
        'toastRef.current?.error(t("errors.generic"));',
        'logger.error(error.message);',
        'console.error(error.message);',
        'toast.success(t("settings.saved"));',
    ],
    invalid: invalid.map(code => ({
        code,
        errors: [{ messageId: 'localized' }],
    })),
});