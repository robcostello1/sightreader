import { nameToMidi } from '../lib/pitch';
import type { Midi } from '../lib/types';
import { POSITIONS as FRETBOARD_POSITIONS, regionPool, type FretboardRegion } from './regions';

export type Clef = 'treble' | 'bass' | 'alto' | 'grand';
export type StaffMode = 'treble' | 'bass' | 'grand';
export type InstrumentFamily = 'keyboard' | 'fretted' | 'bowed_string' | 'woodwind' | 'brass';
export type InstrumentStatus = 'available' | 'comingSoon';

/**
 * An instrument's transposition, as the interval from written to sounding.
 *
 * Semitones alone are not enough: they cannot tell D flat from C sharp, so the
 * diatonic step count comes too. A B flat clarinet sounds a major 2nd below
 * what it reads — two semitones and one letter — which is what turns a concert
 * C major into a written D major rather than an E double-flat major.
 */
export interface Transposition {
  /** sounding = written + semitones. Zero for a non-transposing instrument. */
  semitones: number;
  /** Diatonic steps over the same interval, same sign. */
  letters: number;
  label: string;
}

const AT_PITCH: Transposition = { semitones: 0, letters: 0, label: 'Sounds as written' };
const DOWN_OCTAVE: Transposition = { semitones: -12, letters: -7, label: 'Sounds an octave lower' };
const UP_OCTAVE: Transposition = { semitones: 12, letters: 7, label: 'Sounds an octave higher' };
const DOWN_M2: Transposition = { semitones: -2, letters: -1, label: 'Sounds a major 2nd lower' };
const DOWN_P5: Transposition = { semitones: -7, letters: -4, label: 'Sounds a perfect 5th lower' };
const DOWN_M6: Transposition = { semitones: -9, letters: -5, label: 'Sounds a major 6th lower' };
const DOWN_M9: Transposition = { semitones: -14, letters: -8, label: 'Sounds a major 9th lower' };
const DOWN_M13: Transposition = { semitones: -21, letters: -12, label: 'Sounds a major 13th lower' };

export interface PositionDefinition {
  id: string;
  label: string;
  writtenLow: string;
  writtenHigh: string;
  /** Piano only: which staves are in play. */
  staffMode?: StaffMode;
  /** Guitar only: the fretboard this position covers, which sets the pool. */
  region?: FretboardRegion;
}

export interface InstrumentDefinition {
  id: string;
  name: string;
  family: InstrumentFamily;
  clef: Clef;
  transposition: Transposition;
  /** Only guitar and piano offer a position control. */
  hasPositions: boolean;
  /** Fixed-range instruments. Written pitch, as the player reads it. */
  writtenRange?: { low: string; high: string };
  positions?: PositionDefinition[];
  status: InstrumentStatus;
  /**
   * Set on instruments held back until pitch detection is proven at their
   * register — see the low-fundamental note below.
   */
  comingSoonReason?: string;
}

/**
 * Sounding fundamentals below the guitar's low E (~82Hz) are not yet proven
 * against the detector: longer analysis windows, more octave-error risk, and
 * microphone roll-off all bite down there. These instruments are listed so the
 * picker is honest about scope, but disabled until a note-level viability check
 * replaces this blunt instrument-level gate.
 *
 * Applied as a rule rather than a fixed list: bass clarinet (D2) and baritone
 * saxophone (D flat 2) both fall under it, and a test asserts that no available
 * instrument sounds lower than the guitar's low E.
 */
const LOW_REGISTER = 'Pitch detection is not yet proven below the guitar’s low E.';

const guitarPositions: PositionDefinition[] = FRETBOARD_POSITIONS.map((region) => {
  const pool = regionPool(region);
  return {
    id: region.id,
    label: region.name,
    // Guitar is written an octave above where it sounds.
    writtenLow: nameOf(pool[0] + 12),
    writtenHigh: nameOf(pool[pool.length - 1] + 12),
    region,
  };
});

function nameOf(midi: Midi): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * Piano has no transposition but 88 keys is far too much for one session, so it
 * gets a position control of its own — one that varies which staves are in play
 * as well as the range.
 */
const pianoPositions: PositionDefinition[] = [
  { id: 'rh-5-finger', label: 'Middle C 5-finger (right hand)', writtenLow: 'C4', writtenHigh: 'G4', staffMode: 'treble' },
  { id: 'lh-5-finger', label: 'Middle C 5-finger (left hand)', writtenLow: 'C3', writtenHigh: 'G3', staffMode: 'bass' },
  { id: 'treble-staff', label: 'Treble staff', writtenLow: 'C4', writtenHigh: 'C6', staffMode: 'treble' },
  { id: 'bass-staff', label: 'Bass staff', writtenLow: 'E2', writtenHigh: 'E4', staffMode: 'bass' },
  { id: 'grand-close', label: 'Grand staff, close', writtenLow: 'C3', writtenHigh: 'C6', staffMode: 'grand' },
  { id: 'grand-wide', label: 'Grand staff, wide', writtenLow: 'C2', writtenHigh: 'C7', staffMode: 'grand' },
  { id: 'full-range', label: 'Full range', writtenLow: 'A0', writtenHigh: 'C8', staffMode: 'grand' },
];

export const INSTRUMENTS: InstrumentDefinition[] = [
  {
    id: 'guitar',
    name: 'Guitar',
    family: 'fretted',
    clef: 'treble',
    transposition: DOWN_OCTAVE,
    hasPositions: true,
    positions: guitarPositions,
    status: 'available',
  },
  {
    id: 'piano',
    name: 'Piano',
    family: 'keyboard',
    clef: 'grand',
    transposition: AT_PITCH,
    hasPositions: true,
    positions: pianoPositions,
    status: 'available',
  },
  { id: 'violin', name: 'Violin', family: 'bowed_string', clef: 'treble', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'G3', high: 'A6' }, status: 'available' },
  { id: 'viola', name: 'Viola', family: 'bowed_string', clef: 'alto', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'C3', high: 'E6' }, status: 'available' },
  { id: 'cello', name: 'Cello', family: 'bowed_string', clef: 'bass', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'C2', high: 'C5' }, status: 'comingSoon', comingSoonReason: LOW_REGISTER },
  { id: 'double-bass', name: 'Double bass', family: 'bowed_string', clef: 'bass', transposition: DOWN_OCTAVE, hasPositions: false, writtenRange: { low: 'E2', high: 'G4' }, status: 'comingSoon', comingSoonReason: LOW_REGISTER },
  { id: 'flute', name: 'Flute', family: 'woodwind', clef: 'treble', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'C4', high: 'C7' }, status: 'available' },
  { id: 'piccolo', name: 'Piccolo', family: 'woodwind', clef: 'treble', transposition: UP_OCTAVE, hasPositions: false, writtenRange: { low: 'D4', high: 'C7' }, status: 'available' },
  { id: 'oboe', name: 'Oboe', family: 'woodwind', clef: 'treble', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'Bb3', high: 'F6' }, status: 'available' },
  { id: 'recorder-soprano', name: 'Soprano recorder', family: 'woodwind', clef: 'treble', transposition: UP_OCTAVE, hasPositions: false, writtenRange: { low: 'C4', high: 'D6' }, status: 'available' },
  { id: 'clarinet-bb', name: 'Clarinet in B♭', family: 'woodwind', clef: 'treble', transposition: DOWN_M2, hasPositions: false, writtenRange: { low: 'E3', high: 'C7' }, status: 'available' },
  // Sounds D2 (73Hz), under the guitar's low E — so it is gated by the same
  // rule as the rest, though the source table marked it available.
  { id: 'bass-clarinet-bb', name: 'Bass clarinet in B♭', family: 'woodwind', clef: 'treble', transposition: DOWN_M9, hasPositions: false, writtenRange: { low: 'E3', high: 'C6' }, status: 'comingSoon', comingSoonReason: LOW_REGISTER },
  { id: 'bassoon', name: 'Bassoon', family: 'woodwind', clef: 'bass', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'Bb1', high: 'D5' }, status: 'comingSoon', comingSoonReason: LOW_REGISTER },
  { id: 'alto-sax', name: 'Alto saxophone in E♭', family: 'woodwind', clef: 'treble', transposition: DOWN_M6, hasPositions: false, writtenRange: { low: 'Bb3', high: 'F6' }, status: 'available' },
  { id: 'tenor-sax', name: 'Tenor saxophone in B♭', family: 'woodwind', clef: 'treble', transposition: DOWN_M9, hasPositions: false, writtenRange: { low: 'Bb3', high: 'F6' }, status: 'available' },
  { id: 'soprano-sax', name: 'Soprano saxophone in B♭', family: 'woodwind', clef: 'treble', transposition: DOWN_M2, hasPositions: false, writtenRange: { low: 'Bb3', high: 'F#6' }, status: 'available' },
  // Sounds D flat 2 (69Hz), likewise under the gate.
  { id: 'baritone-sax', name: 'Baritone saxophone in E♭', family: 'woodwind', clef: 'treble', transposition: DOWN_M13, hasPositions: false, writtenRange: { low: 'Bb3', high: 'F6' }, status: 'comingSoon', comingSoonReason: LOW_REGISTER },
  { id: 'trumpet-bb', name: 'Trumpet in B♭', family: 'brass', clef: 'treble', transposition: DOWN_M2, hasPositions: false, writtenRange: { low: 'F#3', high: 'D6' }, status: 'available' },
  { id: 'french-horn', name: 'French horn in F', family: 'brass', clef: 'treble', transposition: DOWN_P5, hasPositions: false, writtenRange: { low: 'B1', high: 'F5' }, status: 'comingSoon', comingSoonReason: LOW_REGISTER },
  { id: 'trombone', name: 'Trombone', family: 'brass', clef: 'bass', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'E2', high: 'Bb4' }, status: 'available' },
  { id: 'tuba', name: 'Tuba', family: 'brass', clef: 'bass', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'D1', high: 'F4' }, status: 'comingSoon', comingSoonReason: LOW_REGISTER },
  { id: 'bass-guitar', name: 'Bass guitar', family: 'fretted', clef: 'bass', transposition: DOWN_OCTAVE, hasPositions: false, writtenRange: { low: 'E2', high: 'G4' }, status: 'comingSoon', comingSoonReason: LOW_REGISTER },
  // Notated at pitch, the standard treatment; the re-entrant high G is a
  // tuning quirk rather than a transposition.
  { id: 'ukulele', name: 'Ukulele', family: 'fretted', clef: 'treble', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'C4', high: 'A5' }, status: 'available' },
  { id: 'mandolin', name: 'Mandolin', family: 'fretted', clef: 'treble', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'G3', high: 'E6' }, status: 'available' },
  { id: 'banjo', name: 'Banjo', family: 'fretted', clef: 'treble', transposition: AT_PITCH, hasPositions: false, writtenRange: { low: 'D3', high: 'D6' }, status: 'available' },
];

export const DEFAULT_INSTRUMENT_ID = 'guitar';

export function instrumentById(id: string): InstrumentDefinition {
  const found = INSTRUMENTS.find((instrument) => instrument.id === id);
  if (!found) throw new Error(`unknown instrument: ${id}`);
  return found;
}

export function positionById(
  instrument: InstrumentDefinition,
  id: string | null,
): PositionDefinition | null {
  if (!instrument.positions) return null;
  return instrument.positions.find((position) => position.id === id) ?? instrument.positions[0];
}

export function writtenToSounding(midi: Midi, instrument: InstrumentDefinition): Midi {
  return midi + instrument.transposition.semitones;
}

export function soundingToWritten(midi: Midi, instrument: InstrumentDefinition): Midi {
  return midi - instrument.transposition.semitones;
}

/**
 * Every pitch the player can produce, in *sounding* terms — which is what the
 * generator, the scorer and the microphone all deal in. Written pitch exists
 * only on the page.
 */
export function soundingPool(
  instrument: InstrumentDefinition,
  position: PositionDefinition | null,
): Midi[] {
  // A fretboard gives a set of reachable pitches rather than a plain span.
  if (position?.region) return regionPool(position.region);

  const range = position
    ? { low: position.writtenLow, high: position.writtenHigh }
    : instrument.writtenRange;
  if (!range) throw new Error(`${instrument.id} has neither a range nor a position`);

  const low = writtenToSounding(nameToMidi(range.low), instrument);
  const high = writtenToSounding(nameToMidi(range.high), instrument);
  return Array.from({ length: high - low + 1 }, (_, i) => low + i);
}

/** The staves in play, which only piano varies. */
export function staffModeFor(
  instrument: InstrumentDefinition,
  position: PositionDefinition | null,
): StaffMode {
  if (instrument.clef === 'grand') return position?.staffMode ?? 'grand';
  return instrument.clef === 'bass' ? 'bass' : 'treble';
}
