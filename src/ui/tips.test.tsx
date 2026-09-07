// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { tipsFor } from './tips';
import { instrumentById } from '../config/instruments';
import { existsSync } from 'node:fs';

const ids = (instrumentId: string, scoring = true) =>
  tipsFor(instrumentById(instrumentId), scoring).map((tip) => tip.id);

describe('which tips a player gets', () => {
  it('starts with the controls, since that is how to start without the mouse', () => {
    expect(ids('guitar')[0]).toBe('controls');
  });

  it('says one thing, in one sentence', () => {
    for (const tip of tipsFor(instrumentById('guitar'), true)) {
      expect(tip.body.split('. ').length).toBe(1);
      expect(tip.body.length).toBeLessThan(110);
    }
  });

  it('offers the range only where there is one to change', () => {
    expect(ids('guitar')).toContain('range');
    expect(ids('violin')).not.toContain('range');
  });

  it('does not tell a pianist to tune', () => {
    expect(ids('guitar')).toContain('tuning');
    expect(ids('piano')).not.toContain('tuning');
  });

  it('says nothing about the microphone when there is none', () => {
    expect(ids('guitar', false)).not.toContain('tuning');
    expect(ids('guitar', false)).not.toContain('guide');
  });
});

describe('the picture each tip points at', () => {
  it('exists in both schemes, for every tip any instrument can reach', () => {
    const all = new Set(
      ['guitar', 'piano', 'violin'].flatMap((id) =>
        [true, false].flatMap((scoring) => tipsFor(instrumentById(id), scoring).map((t) => t.id)),
      ),
    );
    for (const id of all) {
      for (const scheme of ['light', 'dark']) {
        // Regenerate with `node scripts/tip-shots.mjs`.
        expect(existsSync(`public/tips/${id}-${scheme}.png`), `${id}-${scheme}.png`).toBe(true);
      }
    }
  });

  it('describes itself for anyone who cannot see it', () => {
    for (const tip of tipsFor(instrumentById('guitar'), true)) {
      expect(tip.shot.length).toBeGreaterThan(10);
    }
  });
});
