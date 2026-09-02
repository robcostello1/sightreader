/**
 * A statistical report on where the generator actually puts notes inside a
 * pool — not an assertion suite, and skipped unless asked for:
 *
 *   DISTRIBUTION_REPORT=1 npx vitest run src/generator/distribution.report.test.ts
 *
 * Writes to distribution-report.txt (override with OUT=, sample size with RUNS=).
 *
 * It exists because generated phrases feel like they sit at the top or bottom
 * of a range and rarely in the middle. Each section isolates one candidate
 * cause so the effects can be attributed rather than guessed at:
 *
 *   1. where whole phrases sit        — the perceived symptom, measured
 *   2. per-pitch note distribution    — the same thing note by note
 *   3. pool holes                     — pitches a fretted position cannot reach
 *   4. structural coverage            — what the pool and idioms alone allow
 *   5. register window coverage       — the sliding window's edge starvation
 *   6. bias vs structure              — rangeBias even, and leaning either way
 *   7. key sensitivity                — which holes are diatonic, by key
 *   8. pitch-choice policies          — what alternative weightings would give
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { generateExercise } from './generate';
import { levelConfig } from '../config/levels';
import { instrumentById, positionById, soundingPool } from '../config/instruments';
import { keysUpTo, type MusicalKey } from '../lib/key';
import { IDIOM_LIBRARY, placementPitches } from '../idioms';
import { MAJOR_SCALE } from '../idioms/scale';
import { DEFAULT_VIABILITY } from '../config/viability';
import { startPitchWeight, validPlacements } from './placement';
import type { Midi } from '../lib/types';

const RUNS = Number(process.env.RUNS ?? 3000);
const OUT = process.env.OUT ?? 'distribution-report.txt';

/** Matches registerWindow in generate.ts. Kept in step by hand. */
const MAX_EXERCISE_SPAN = 28;

const out: string[] = [];
const log = (line = '') => out.push(line);
const flush = () => writeFileSync(OUT, `${out.join('\n')}\n`);

function name(midi: Midi): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

interface Case {
  label: string;
  pool: readonly Midi[];
}

function poolOf(instrumentId: string, positionId: string | null): Case {
  const instrument = instrumentById(instrumentId);
  const position = positionById(instrument, positionId);
  return {
    label: `${instrument.name}${position ? `/${position.label}` : ''}`,
    pool: soundingPool(instrument, position),
  };
}

const GUITAR_POSITIONS = ['open', 'pos-2', 'pos-4', 'pos-5', 'pos-7', 'pos-9', 'pos-12'];

const CASES: [string, string | null][] = [
  ...GUITAR_POSITIONS.map((id) => ['guitar', id] as [string, string | null]),
  ['bass-guitar', null],
  ['ukulele', null],
  ['violin', null],
  ['cello', null],
  ['trumpet-bb', null],
  ['piano', 'rh-5-finger'],
  ['piano', 'treble-staff'],
  ['piano', 'bass-staff'],
  ['piano', 'grand-close'],
  ['piano', 'grand-wide'],
];

function keyNamed(keyName: string): MusicalKey {
  const key = keysUpTo(7).find((candidate) => candidate.name === keyName);
  if (!key) throw new Error(`unknown key: ${keyName}`);
  return key;
}

/** The generator's own rule, repeated here so a pool can be analysed statically. */
function keyCentreFor(key: MusicalKey, low: Midi): Midi {
  const candidate = Math.floor(low / 12) * 12 + key.tonic;
  return candidate <= low ? candidate : candidate - 12;
}

/** Semitones inside the span that the region cannot reach at all. */
function holes(pool: readonly Midi[]): Midi[] {
  const set = new Set(pool);
  const gaps: Midi[] = [];
  for (let midi = pool[0]; midi <= pool[pool.length - 1]; midi++) if (!set.has(midi)) gaps.push(midi);
  return gaps;
}

function isDegreeOf(key: MusicalKey, midi: Midi): boolean {
  const offset = (((midi - key.tonic) % 12) + 12) % 12;
  return (MAJOR_SCALE as readonly number[]).includes(offset);
}

interface Sample {
  counts: Map<Midi, number>;
  notes: number;
  deciles: number[];
  mean: number;
}

function sample(pool: readonly Midi[], level: number, rangeBias?: number, key?: MusicalKey): Sample {
  const low = pool[0];
  const high = pool[pool.length - 1];
  const counts = new Map<Midi, number>();
  const deciles = new Array(10).fill(0);
  let notes = 0;
  let sum = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const exercise = generateExercise({
      level: levelConfig(level),
      pool,
      seed,
      ...(rangeBias === undefined ? {} : { rangeBias }),
      ...(key === undefined ? {} : { key }),
    });
    for (const note of exercise.notes) {
      if (note.midi === null) continue;
      counts.set(note.midi, (counts.get(note.midi) ?? 0) + 1);
      const norm = (note.midi - low) / (high - low);
      deciles[Math.min(9, Math.floor(norm * 10))]++;
      sum += norm;
      notes++;
    }
  }
  return { counts, notes, deciles, mean: sum / notes };
}

/** Outer 20% of the span against the middle 20% — the shape of the complaint. */
function edgeMiddle(deciles: readonly number[], notes: number) {
  const edge = (deciles[0] + deciles[1] + deciles[8] + deciles[9]) / notes;
  const middle = (deciles[4] + deciles[5]) / notes;
  return { edge, middle, ratio: edge / middle };
}

/** Share of the notes carried by the busiest quarter of the pool. Uniform = 25%. */
function topQuarter(counts: Map<Midi, number>, pool: readonly Midi[], notes: number): number {
  const sorted = [...counts.values()].sort((a, b) => b - a);
  return sorted.slice(0, Math.max(1, Math.round(pool.length / 4))).reduce((a, b) => a + b, 0) / notes;
}

function histogram(counts: Map<Midi, number>, pool: readonly Midi[]): void {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const max = Math.max(...counts.values(), 1);
  for (const midi of pool) {
    const n = counts.get(midi) ?? 0;
    log(
      `    ${String(midi).padStart(3)} ${name(midi).padEnd(4)} ${String(n).padStart(6)} ` +
        `${((100 * n) / total).toFixed(2).padStart(5)}%  ${'#'.repeat(Math.round((40 * n) / max))}`,
    );
  }
}

/** Every valid placement for a pool in one key, with its concrete pitches. */
function enumeratePlacements(pool: readonly Midi[], key: MusicalKey, level = 3) {
  const config = levelConfig(level);
  const low = pool[0];
  const high = pool[pool.length - 1];
  const constraints = {
    keyCenter: keyCentreFor(key, low),
    pool: new Set(pool),
    low,
    high,
    maxInterval: config.maxLocalInterval,
    viability: { config: DEFAULT_VIABILITY, scoring: config.scoring, bpm: 60, beatUnit: 4 },
  };
  const placements: Midi[][] = [];
  for (const idiom of IDIOM_LIBRARY) {
    for (const { value } of config.noteValues) {
      for (const placement of validPlacements(idiom, value, constraints)) {
        placements.push(placementPitches(placement));
      }
    }
  }
  return { placements, low, high };
}

/** Marginal pitch distribution implied by a set of placement weights. */
function marginal(placements: Midi[][], weights: readonly number[], pool: readonly Midi[]) {
  const shares = new Map<Midi, number>(pool.map((midi) => [midi, 0]));
  let total = 0;
  placements.forEach((pitches, i) => {
    for (const midi of pitches) {
      shares.set(midi, (shares.get(midi) ?? 0) + weights[i]);
      total += weights[i];
    }
  });
  for (const [midi, n] of shares) shares.set(midi, total === 0 ? 0 : n / total);
  return shares;
}

/**
 * Iterative proportional fitting towards an even share per reachable pitch.
 * Shown as a target to measure against, not as a proposed implementation.
 */
function flattened(placements: Midi[][], pool: readonly Midi[], rounds = 200): number[] {
  const reachable = pool.filter((midi) => placements.some((pitches) => pitches.includes(midi)));
  const target = 1 / reachable.length;
  let weights = placements.map(() => 1);
  for (let round = 0; round < rounds; round++) {
    const shares = marginal(placements, weights, pool);
    weights = placements.map((pitches, i) => {
      const adjust = pitches.reduce((sum, midi) => {
        const share = shares.get(midi) ?? 0;
        return sum + (share === 0 ? 1 : target / share);
      }, 0);
      return weights[i] * (adjust / pitches.length) ** 0.5;
    });
  }
  return weights;
}

function policyLine(label: string, shares: Map<Midi, number>, pool: readonly Midi[]): void {
  const low = pool[0];
  const high = pool[pool.length - 1];
  const deciles = new Array(10).fill(0);
  for (const [midi, share] of shares) {
    deciles[Math.min(9, Math.floor(((midi - low) / (high - low)) * 10))] += share;
  }
  const { edge, middle, ratio } = edgeMiddle(deciles, 1);
  const used = [...shares.values()].filter((share) => share > 1e-9).sort((a, b) => b - a);
  const top = used.slice(0, Math.max(1, Math.round(pool.length / 4))).reduce((a, b) => a + b, 0);
  log(
    `  ${label.padEnd(28)} edge ${(100 * edge).toFixed(1).padStart(5)}%  mid ${(100 * middle)
      .toFixed(1)
      .padStart(5)}%  E/M ${ratio.toFixed(2).padStart(6)}  top1/4 ${(100 * top)
      .toFixed(1)
      .padStart(5)}%  busiest/quietest ${(used[0] / used[used.length - 1]).toFixed(1).padStart(6)}x`,
  );
}

describe.skipIf(!process.env.DISTRIBUTION_REPORT)('generated note distribution', () => {
  it('1. where whole phrases sit', () => {
    log('\n########## 1. WHERE WHOLE PHRASES SIT (level 3, shipped defaults) ##########');
    log('Each exercise is scored by the mean position of its notes in the range, 0 =');
    log('bottom, 1 = top. "confined" is the share of exercises whose every note stays');
    log('inside the outer third at one end — the phrase never visits the middle.\n');
    log(
      'pool'.padEnd(28) +
        ['bottom%', 'mid%', 'top%', 'confined%', 'spans mid%'].map((h) => h.padStart(12)).join(''),
    );
    log('-'.repeat(88));
    for (const [id, position] of CASES) {
      const { label, pool } = poolOf(id, position);
      const low = pool[0];
      const high = pool[pool.length - 1];
      const centres = new Array(10).fill(0);
      let bottom = 0;
      let middle = 0;
      let top = 0;
      let confined = 0;
      let spansMiddle = 0;
      let n = 0;
      for (let seed = 1; seed <= RUNS; seed++) {
        const pitches = generateExercise({ level: levelConfig(3), pool, seed }).notes
          .map((note) => note.midi)
          .filter((midi): midi is Midi => midi !== null);
        if (pitches.length === 0) continue;
        n++;
        const norm = pitches.map((midi) => (midi - low) / (high - low));
        const mean = norm.reduce((a, b) => a + b, 0) / norm.length;
        centres[Math.min(9, Math.floor(mean * 10))]++;
        if (mean < 1 / 3) bottom++;
        else if (mean > 2 / 3) top++;
        else middle++;
        if (norm.every((v) => v < 1 / 3) || norm.every((v) => v > 2 / 3)) confined++;
        if (norm.some((v) => v >= 1 / 3 && v <= 2 / 3)) spansMiddle++;
      }
      log(
        label.padEnd(28) +
          [bottom, middle, top, confined, spansMiddle]
            .map((v) => ((100 * v) / n).toFixed(1).padStart(12))
            .join(''),
      );
      log(
        `  phrase-centre deciles: ${centres
          .map((b) => ((100 * b) / n).toFixed(1).padStart(5))
          .join(' ')}   (uniform = 10.0)`,
      );
    }
    flush();
  }, 900_000);

  it('2. per-pitch note distribution', () => {
    log('\n########## 2. PER-PITCH NOTE DISTRIBUTION ##########');
    for (const [id, position] of CASES) {
      const { label, pool } = poolOf(id, position);
      for (const level of [1, 3, 5, 8]) {
        const stats = sample(pool, level);
        const { edge, middle, ratio } = edgeMiddle(stats.deciles, stats.notes);
        const unused = pool.filter((midi) => !stats.counts.has(midi));
        log(`\n--- ${label} | level ${level}`);
        log(
          `  pool ${pool.length} pitches ${name(pool[0])}–${name(pool[pool.length - 1])}, ` +
            `span ${pool[pool.length - 1] - pool[0]} semitones, ${stats.notes} notes`,
        );
        log(`  mean position ${stats.mean.toFixed(3)} (0.5 = centred)`);
        log(
          `  deciles ${stats.deciles
            .map((n) => ((100 * n) / stats.notes).toFixed(1).padStart(5))
            .join(' ')}  (uniform = 10.0)`,
        );
        log(
          `  edge ${(100 * edge).toFixed(1)}% vs middle ${(100 * middle).toFixed(1)}% = ` +
            `${ratio.toFixed(2)}x; busiest quarter of the pool holds ` +
            `${(100 * topQuarter(stats.counts, pool, stats.notes)).toFixed(1)}%`,
        );
        if (unused.length > 0) log(`  never generated (${unused.length}): ${unused.map(name).join(' ')}`);
        if (level === 3) histogram(stats.counts, pool);
      }
    }
    flush();
  }, 900_000);

  it('3. pool holes', () => {
    log('\n########## 3. POOL HOLES ##########');
    log('A fretted position reaches a set of pitches, not a span. A hole that lands');
    log('on a scale degree severs the diatonic ladder: every idiom spanning it is');
    log('rejected outright, so the pool breaks into islands.\n');
    for (const [id, position] of CASES) {
      const { label, pool } = poolOf(id, position);
      const gaps = holes(pool);
      log(
        `${label}  ${name(pool[0])}–${name(pool[pool.length - 1])}  ` +
          `${pool.length} pitches, ${gaps.length} holes`,
      );
      if (gaps.length === 0) {
        log('');
        continue;
      }
      log(`  holes: ${gaps.map((midi) => `${name(midi)}(${midi})`).join(' ')}`);
      const severed = keysUpTo(2)
        .map((key) => ({ key, missing: gaps.filter((midi) => isDegreeOf(key, midi)) }))
        .filter((entry) => entry.missing.length > 0)
        .map((entry) => `${entry.key.name}: ${entry.missing.map(name).join(',')}`);
      if (severed.length > 0) log(`  diatonic holes — ${severed.join(' | ')}`);
      log('');
    }
    flush();
  }, 900_000);

  it('4. structural coverage', () => {
    log('\n########## 4. STRUCTURAL COVERAGE (level 3, C major, unweighted) ##########');
    log('How many valid placements cover each pitch, before any weighting. This is');
    log('the shape the generator is choosing from.\n');
    for (const [id, position] of CASES) {
      const { label, pool } = poolOf(id, position);
      if (pool[pool.length - 1] - pool[0] > MAX_EXERCISE_SPAN) continue; // windowed; see section 5
      const { placements } = enumeratePlacements(pool, keyNamed('C'));
      const cover = new Map<Midi, number>();
      const anchors = new Map<Midi, number>();
      for (const pitches of placements) {
        anchors.set(pitches[0], (anchors.get(pitches[0]) ?? 0) + 1);
        for (const midi of pitches) cover.set(midi, (cover.get(midi) ?? 0) + 1);
      }
      log(`--- ${label}: ${placements.length} valid placements`);
      const max = Math.max(...cover.values(), 1);
      for (const midi of pool) {
        const n = cover.get(midi) ?? 0;
        log(
          `  ${String(midi).padStart(3)} ${name(midi).padEnd(4)} covered ${String(n).padStart(4)} ` +
            `first note ${String(anchors.get(midi) ?? 0).padStart(4)}  ` +
            '#'.repeat(Math.round((40 * n) / max)),
        );
      }
      log('');
    }
    flush();
  }, 900_000);

  it('5. register window coverage', () => {
    log('\n########## 5. REGISTER WINDOW COVERAGE ##########');
    log('registerWindow draws a 28-semitone window over a wider pool with a uniform');
    log('start, so the ends of the pool sit inside only a handful of windows while');
    log('the middle sits inside every one.\n');
    for (const [id, position] of CASES) {
      const { label, pool } = poolOf(id, position);
      const low = pool[0];
      const high = pool[pool.length - 1];
      if (high - low <= MAX_EXERCISE_SPAN) continue;
      const starts = high - low - MAX_EXERCISE_SPAN + 1;
      log(`--- ${label}: span ${high - low}, ${starts} possible window starts`);
      let worst = 1;
      for (const midi of pool) {
        const first = Math.max(0, midi - low - MAX_EXERCISE_SPAN);
        const last = Math.min(starts - 1, midi - low);
        const p = Math.max(0, last - first + 1) / starts;
        worst = Math.min(worst, p);
        log(`  ${String(midi).padStart(3)} ${name(midi).padEnd(4)} P=${p.toFixed(3)}  ${'#'.repeat(Math.round(40 * p))}`);
      }
      log(
        `  least-covered pitch is reachable in ${(100 * worst).toFixed(1)}% of windows ` +
          `against 100% for the middle — a ${(1 / worst).toFixed(0)}x availability gap.`,
      );
      log('');
    }
    flush();
  }, 900_000);

  it('6. bias against structure', () => {
    log('\n########## 6. BIAS AGAINST STRUCTURE (level 3) ##########');
    log('The same pools with rangeBias even (1, the default), leaning to the edges');
    log('(4) and leaning to the middle (0.25), so structure and lean can be told');
    log('apart. 4 reproduces the lean this generator used to ship with.\n');
    const header =
      'pool'.padEnd(30) +
      'span'.padStart(5) +
      ['bias', 'edge%', 'mid%', 'E/M', 'mean', 'top1/4', 'unused'].map((h) => h.padStart(9)).join('');
    log(header);
    log('-'.repeat(header.length));
    for (const [id, position] of CASES) {
      const { label, pool } = poolOf(id, position);
      for (const bias of [1, 4, 0.25]) {
        const stats = sample(pool, 3, bias);
        const { edge, middle, ratio } = edgeMiddle(stats.deciles, stats.notes);
        log(
          label.padEnd(30) +
            String(pool[pool.length - 1] - pool[0]).padStart(5) +
            String(bias).padStart(9) +
            (100 * edge).toFixed(1).padStart(9) +
            (100 * middle).toFixed(1).padStart(9) +
            ratio.toFixed(2).padStart(9) +
            stats.mean.toFixed(3).padStart(9) +
            (100 * topQuarter(stats.counts, pool, stats.notes)).toFixed(1).padStart(9) +
            `${pool.length - stats.counts.size}/${pool.length}`.padStart(9),
        );
      }
    }
    flush();
  }, 900_000);

  it('7. key sensitivity on fretted positions', () => {
    log('\n########## 7. KEY SENSITIVITY (guitar, level 3, default rangeBias) ##########');
    log('Which of a position\'s holes are diatonic depends on the key, and that alone');
    log('swings the distribution from extremity-heavy to middle-heavy.\n');
    log(
      'position'.padEnd(12) +
        'key'.padEnd(6) +
        ['edge%', 'mid%', 'E/M', 'unused'].map((h) => h.padStart(10)).join(''),
    );
    log('-'.repeat(58));
    for (const position of GUITAR_POSITIONS) {
      const { pool } = poolOf('guitar', position);
      for (const keyName of ['C', 'G', 'F', 'D', 'Bb']) {
        const stats = sample(pool, 3, undefined, keyNamed(keyName));
        const { edge, middle, ratio } = edgeMiddle(stats.deciles, stats.notes);
        log(
          position.padEnd(12) +
            keyName.padEnd(6) +
            (100 * edge).toFixed(1).padStart(10) +
            (100 * middle).toFixed(1).padStart(10) +
            ratio.toFixed(2).padStart(10) +
            `${pool.length - stats.counts.size}/${pool.length}`.padStart(10),
        );
      }
      log('');
    }
    flush();
  }, 900_000);

  it('8. pitch-choice policies', () => {
    log('\n########## 8. PITCH-CHOICE POLICIES (level 3, placements enumerated) ##########');
    log('The marginal pitch distribution each weighting would produce, with every');
    log('other roll the generator makes held out. Uniform reference: edge 20%, mid');
    log('20%, E/M 1.00, top1/4 25%, busiest/quietest 1.0x.\n');
    const policyCases: [string, string | null, string][] = [
      ['guitar', 'open', 'C'],
      ['guitar', 'pos-4', 'C'],
      ['guitar', 'pos-5', 'C'],
      ['guitar', 'pos-5', 'G'],
      ['guitar', 'pos-12', 'D'],
      ['piano', 'treble-staff', 'C'],
      ['violin', null, 'C'],
    ];
    for (const [id, position, keyName] of policyCases) {
      const { label, pool } = poolOf(id, position);
      const { placements, low, high } = enumeratePlacements(pool, keyNamed(keyName));
      log(`--- ${label}, key ${keyName}: ${placements.length} valid placements`);
      policyLine('even (rangeBias 1)', marginal(placements, placements.map(() => 1), pool), pool);
      for (const bias of [2, 4]) {
        const weights = placements.map((pitches) => startPitchWeight(pitches[0], low, high, bias));
        policyLine(`first note, rangeBias ${bias}`, marginal(placements, weights, pool), pool);
      }
      const centred = placements.map((pitches) =>
        startPitchWeight(
          Math.round(pitches.reduce((a, b) => a + b, 0) / pitches.length),
          low,
          high,
          4,
        ),
      );
      policyLine('rangeBias 4 on centre pitch', marginal(placements, centred, pool), pool);
      policyLine('flat per reachable pitch', marginal(placements, flattened(placements, pool), pool), pool);
      log('');
    }
    flush();
  }, 900_000);
});
