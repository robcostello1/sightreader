// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { tipsFor } from './tips';
import { instrumentById } from '../config/instruments';

const ids = (instrumentId: string, scoring = true) =>
  tipsFor(instrumentById(instrumentId), scoring).map((tip) => tip.id);

describe('which tips a player gets', () => {
  it('starts with the controls, since that is how to start without the mouse', () => {
    expect(ids('guitar')[0]).toBe('controls');
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
