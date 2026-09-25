import { describe, expect, it } from 'vitest';
import { DICTS, makeT } from '../src/ui/i18n';

describe('translations', () => {
  it('Arabic and English define the same keys', () => {
    const en = Object.keys(DICTS.en).sort();
    const ar = Object.keys(DICTS.ar).sort();
    expect(ar).toEqual(en);
  });

  it('fills parameters', () => {
    expect(makeT('en')('race.lap', { lap: 2, time: '12.34' })).toBe('Lap 2: 12.34');
    expect(makeT('ar')('drill.next', { n: 1, total: 3 })).toBe('الهدف 1 من 3');
  });
});
