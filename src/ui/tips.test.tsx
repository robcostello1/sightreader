// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { WELCOME, tipsFor } from './tips';
import { instrumentById } from '../config/instruments';
import { existsSync } from 'node:fs';
import shotSizes from './tip-shots.json';

const ids = (instrumentId: string, scoring = true) =>
  tipsFor(instrumentById(instrumentId), scoring).map((tip) => tip.id);

describe('which tips a player gets', () => {
  it('starts with the controls, since that is how to start without the mouse', () => {
    expect(ids('guitar')[0]).toBe('controls');
  });

  it('says one thing, briefly', () => {
    for (const tip of tipsFor(instrumentById('guitar'), true)) {
      expect(tip.body.split('. ').length).toBeLessThanOrEqual(2);
      expect(tip.body.length).toBeLessThan(110);
    }
  });

  it('writes a key as a key, so the card can draw it as one', () => {
    const controls = tipsFor(instrumentById('guitar'), true)[0];
    expect(controls.body).toContain('[Space]');
    expect(controls.body).toContain('[?]');
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
        // Regenerate with `npm run tip-shots`.
        expect(existsSync(`public/tips/${id}-${scheme}.png`), `${id}-${scheme}.png`).toBe(true);
      }
      // And a size to draw it at. Without one the card used to read width off
      // undefined and take the whole page down with it.
      expect(Object.keys(shotSizes), `${id} size`).toContain(id);
    }
  });

  it('describes itself for anyone who cannot see it', () => {
    for (const tip of tipsFor(instrumentById('guitar'), true)) {
      expect(tip.shot!.length).toBeGreaterThan(10);
    }
  });
});

describe('the welcome', () => {
  it('says what to do rather than pointing at something', () => {
    expect(WELCOME.title).toBe('Welcome');
    expect(WELCOME.body).toMatch(/choose your level and tempo/);
    // Nothing to point at: it is about the whole screen.
    expect(WELCOME.shot).toBeUndefined();
  });

  it('is not one of the tips it sits in front of', () => {
    expect(tipsFor(instrumentById('guitar'), true).map((t) => t.id)).not.toContain('welcome');
  });
});
