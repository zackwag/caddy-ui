import { describe, expect, it } from 'vitest';
import { translatedCount, validateSubset } from '../scripts/localization.mjs';

const english = {
    logs: {
        title: 'Logs',
        lineCount_one: '{{count}} line',
        lineCount_other: '{{count}} lines',
    },
};

describe('localization catalog contract', () => {
    it('accepts plural forms English does not use', () => {
        const fewManyLocale = {
            logs: {
                lineCount_one: 'one form',
                lineCount_few: 'few form',
                lineCount_many: 'many form',
                lineCount_other: 'other form',
            },
        };

        expect(() => validateSubset(english, fewManyLocale, 'xx')).not.toThrow();
    });

    it('still rejects keys that are not plural forms of an English key', () => {
        expect(() => validateSubset(english, { logs: { titel: 'placeholder' } }, 'xx')).toThrow('unknown key "logs.titel"');
        expect(() => validateSubset(english, { logs: { title_few: 'placeholder' } }, 'xx')).toThrow('unknown key "logs.title_few"');
    });

    it('counts a plural group once any of its forms is translated', () => {
        expect(translatedCount(english, { logs: { lineCount_other: 'other form' } })).toBe(2);
        expect(translatedCount(english, { logs: { title: 'placeholder', lineCount_few: 'few form' } })).toBe(3);
        expect(translatedCount(english, {})).toBe(0);
    });
});
