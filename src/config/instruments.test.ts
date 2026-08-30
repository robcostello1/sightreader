import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTRUMENT_ID,
  INSTRUMENTS,
  instrumentById,
  positionById,
  soundingPool,
  soundingToWritten,
  staffModeFor,
  writtenToSounding,
} from './instruments';
import { keyByName, transposeKey } from '../lib/key';
import { midiToName, nameToMidi } from '../lib/pitch';

const written = (id: string, name: string) =>
  midiToName(soundingToWritten(nameToMidi(name), instrumentById(id)));

describe('instrument catalogue', () => {
  it('has unique ids and a usable default', () => {
    const ids = INSTRUMENTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(instrumentById(DEFAULT_INSTRUMENT_ID).status).toBe('available');
  });

  it('offers positions only for guitar and piano', () => {
    const withPositions = INSTRUMENTS.filter((i) => i.hasPositions).map((i) => i.id);
    expect(withPositions).toEqual(['guitar', 'piano']);
    for (const instrument of INSTRUMENTS) {
      // Everything else must carry a fixed range instead.
      if (!instrument.hasPositions) expect(instrument.writtenRange).toBeDefined();
      else expect(instrument.positions?.length).toBeGreaterThan(0);
    }
  });

  it('holds back exactly the instruments that sound below the guitar’s low E', () => {
    const guitarLow = nameToMidi('E2');
    for (const instrument of INSTRUMENTS) {
      const pool = soundingPool(instrument, positionById(instrument, null));
      const low = Math.min(...pool);
      if (low < guitarLow) {
        expect(instrument.status).toBe('comingSoon');
        expect(instrument.comingSoonReason).toBeTruthy();
      } else {
        expect(instrument.status).toBe('available');
      }
    }
  });

  it('applies the same floor to every position, not just the default one', () => {
    // Checking only the default position let piano's wide positions through:
    // "Full range" reached down to A0, four octaves under the floor the rule
    // holds every other instrument to.
    const guitarLow = nameToMidi('E2');
    for (const instrument of INSTRUMENTS) {
      if (instrument.status !== 'available') continue;
      for (const position of instrument.positions ?? []) {
        const low = Math.min(...soundingPool(instrument, position));
        expect(`${instrument.id}/${position.id}: ${low}`).toBe(
          `${instrument.id}/${position.id}: ${Math.max(low, guitarLow)}`,
        );
      }
    }
  });

  it('gates every low-register instrument, including the two the spec missed', () => {
    // Bass clarinet sounds D2 and baritone sax D flat 2 — both under the
    // guitar's low E, so both are held back by the same rule even though the
    // source table listed them as available.
    expect(INSTRUMENTS.filter((i) => i.status === 'comingSoon').map((i) => i.id)).toEqual([
      'cello',
      'double-bass',
      'bass-clarinet-bb',
      'bassoon',
      'baritone-sax',
      'french-horn',
      'tuba',
      'bass-guitar',
    ]);
  });
});

describe('transposition', () => {
  it('writes guitar an octave above where it sounds', () => {
    // The whole point: low E reads as E3, not buried under ledger lines at E2.
    expect(written('guitar', 'E2')).toBe('E3');
    expect(writtenToSounding(nameToMidi('E3'), instrumentById('guitar'))).toBe(nameToMidi('E2'));
  });

  it('leaves non-transposing instruments alone', () => {
    expect(written('flute', 'C4')).toBe('C4');
    expect(written('violin', 'G3')).toBe('G3');
  });

  it('writes a B flat clarinet a major 2nd above concert', () => {
    expect(written('clarinet-bb', 'D3')).toBe('E3');
  });

  it('writes an E flat alto sax a major 6th above concert', () => {
    expect(written('alto-sax', 'Db3')).toBe('A#3'); // enharmonic of Bb3
  });

  it('writes piccolo an octave below what it sounds', () => {
    // It sounds higher than written, so the page shows the lower octave.
    expect(written('piccolo', 'D5')).toBe('D4');
  });
});

describe('key transposition follows the instrument', () => {
  const writtenKey = (id: string, concert: string) => {
    const { transposition } = instrumentById(id);
    return transposeKey(keyByName(concert), -transposition.semitones, -transposition.letters).name;
  };

  it('leaves the key alone at concert pitch', () => {
    expect(writtenKey('flute', 'C')).toBe('C');
    expect(writtenKey('guitar', 'F')).toBe('F');
  });

  it('reads concert C as D for a B flat instrument', () => {
    expect(writtenKey('clarinet-bb', 'C')).toBe('D');
    expect(writtenKey('trumpet-bb', 'Bb')).toBe('C');
    // A major 9th and a major 2nd land on the same key, an octave apart.
    expect(writtenKey('tenor-sax', 'C')).toBe('D');
  });

  it('reads concert C as A for an E flat instrument', () => {
    expect(writtenKey('alto-sax', 'C')).toBe('A');
    expect(writtenKey('baritone-sax', 'C')).toBe('A');
  });

  it('reads concert C as G for a horn in F', () => {
    expect(writtenKey('french-horn', 'C')).toBe('G');
  });

  it('falls back to the enharmonic rather than an unwritable key signature', () => {
    // Concert B up a major 6th is G sharp major — eight sharps. No score does
    // that; it is written A flat.
    expect(writtenKey('alto-sax', 'B')).toBe('Ab');
  });

  it('never produces a key beyond seven accidentals, whatever the instrument', () => {
    for (const instrument of INSTRUMENTS) {
      for (const concert of ['C', 'G', 'F', 'D', 'Bb', 'A', 'Eb', 'E', 'Ab', 'B', 'Db']) {
        const { transposition } = instrument;
        const key = transposeKey(
          keyByName(concert),
          -transposition.semitones,
          -transposition.letters,
        );
        expect(Math.abs(key.accidentals)).toBeLessThanOrEqual(7);
      }
    }
  });
});

describe('sounding pools', () => {
  it('keeps the guitar fretboard pool for its positions', () => {
    const guitar = instrumentById('guitar');
    const pool = soundingPool(guitar, positionById(guitar, 'open'));
    expect(midiToName(Math.min(...pool))).toBe('E2');
    expect(midiToName(Math.max(...pool))).toBe('G#4');
  });

  it('spans a fixed range chromatically for everything else', () => {
    const pool = soundingPool(instrumentById('flute'), null);
    expect(midiToName(Math.min(...pool))).toBe('C4');
    expect(midiToName(Math.max(...pool))).toBe('C7');
  });

  it('shifts a transposing instrument’s pool into sounding pitch', () => {
    // Written B flat 3 on an alto sax sounds a major 6th lower.
    const pool = soundingPool(instrumentById('alto-sax'), null);
    expect(Math.min(...pool)).toBe(nameToMidi('Db3'));
  });

  it('gives piano the range of the chosen position', () => {
    const piano = instrumentById('piano');
    const pool = soundingPool(piano, positionById(piano, 'rh-5-finger'));
    expect(midiToName(Math.min(...pool))).toBe('C4');
    expect(midiToName(Math.max(...pool))).toBe('G4');
  });
});

describe('staff mode', () => {
  it('follows the clef for single-staff instruments', () => {
    expect(staffModeFor(instrumentById('flute'), null)).toBe('treble');
    expect(staffModeFor(instrumentById('trombone'), null)).toBe('bass');
    expect(staffModeFor(instrumentById('viola'), null)).toBe('treble');
  });

  it('follows the position for piano', () => {
    const piano = instrumentById('piano');
    expect(staffModeFor(piano, positionById(piano, 'lh-5-finger'))).toBe('bass');
    expect(staffModeFor(piano, positionById(piano, 'grand-close'))).toBe('grand');
  });
});
