import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Score } from './notation';
import { generateExercise } from './generator';
import { levelConfig, levelSummary } from './config/levels';
import { OPEN_POSITION, regionPool } from './config/regions';
import { instrumentById, positionById, soundingPool } from './config/instruments';
import { applyTheme } from './lib/theme';
import { Heading, Text } from './ui/Text';
import './index.css';

// ?theme=light|dark, so both schemes can be eyeballed without changing the
// machine's own setting.
const requested = new URLSearchParams(location.search).get('theme');
if (requested === 'light' || requested === 'dark') applyTheme(requested);

/**
 * Dev-only page for eyeballing notation across tiers and seeds without playing
 * through a lesson. Served at /preview.html in dev; not part of the build.
 */
// Whole levels plus the fade across level 3, to show new ideas arriving.
// Whole levels, the fade across level 3, and seeds that previously laid out
// badly — dense bars and triplets near a bar line.
const SAMPLES = [
  ...Array.from({ length: 10 }, (_, i) => ({ level: i + 1, seed: 42 })),
  ...[3.0, 3.3, 3.6, 3.9].map((level) => ({ level, seed: 8 })),
  { level: 5, seed: 36 },
  { level: 5.5, seed: 11 },
  { level: 10, seed: 7 },
];

// The grand staff has its own failure modes — a hand full of stand-in rests,
// tuplet brackets over the wrong staff — so it gets its own row of samples.
const PIANO = [
  { position: 'grand-close', level: 4, seed: 3 },
  { position: 'grand-close', level: 7, seed: 12 },
  { position: 'grand-wide', level: 5, seed: 21 },
  { position: 'grand-wide', level: 10, seed: 17 },
  // Tuplets against a silent hand, in both signatures, and one that straddles
  // middle C — the shapes that laid out worst.
  { position: 'grand-close', level: 6, seed: 1 },
  { position: 'grand-close', level: 8, seed: 8 },
  { position: 'grand-close', level: 8, seed: 9 },
  { position: 'grand-wide', level: 9, seed: 5 },
];

// The ghost note, at the distances from the written pitch that matter: dead on,
// a semitone out, and far enough away to need ledger lines and an accidental.
const HEARD: { heard: number | null; label: string }[] = [
  { heard: null, label: 'nothing heard' },
  { heard: 67, label: 'the written note' },
  { heard: 66, label: 'a semitone flat' },
  { heard: 69, label: 'a tone sharp' },
  { heard: 55, label: 'an octave down' },
  { heard: 84, label: 'well above the staff' },
];

// eslint-disable-next-line react/only-export-components -- dev-only entry point
function Preview() {
  return (
    <main>
      <Heading level={1} className="preview-title">Notation preview</Heading>
      {SAMPLES.map(({ level, seed }) => {
        const config = levelConfig(level);
        const exercise = generateExercise({ level: config, pool: regionPool(OPEN_POSITION), seed });
        return (
          <section key={`${level}`}>
            <Text tone="muted">
              <strong>Level {level.toFixed(1)}</strong> · {exercise.key.name} major ·{' '}
              {exercise.notes.length} notes
            </Text>
            <Text tone="muted">{levelSummary(config).join(' · ')}</Text>
            <Score exercise={exercise} />
          </section>
        );
      })}

      <Heading level={1} className="preview-title">Heard note</Heading>
      <Text tone="muted">
        The ghost laid over the note being played, at pitches a player might
        actually produce against a written G4. Needs no microphone to look at.
      </Text>
      {HEARD.map(({ heard, label }) => {
        const exercise = generateExercise({ level: levelConfig(2), pool: regionPool(OPEN_POSITION), seed: 4 });
        return (
          <section key={label}>
            <Text tone="muted">
              <strong>{label}</strong>
            </Text>
            <Score exercise={exercise} activeIndex={0} heardMidi={heard} />
          </section>
        );
      })}

      <Heading level={1} className="preview-title">Piano</Heading>
      {PIANO.map(({ position: positionId, level, seed }) => {
        const instrument = instrumentById('piano');
        const position = positionById(instrument, positionId)!;
        const config = levelConfig(level);
        const exercise = generateExercise({
          level: config,
          pool: soundingPool(instrument, position),
          seed,
        });
        return (
          <section key={`piano-${positionId}-${level}-${seed}`}>
            <Text tone="muted">
              <strong>
                {position.label} · level {level.toFixed(1)}
              </strong>{' '}
              · {exercise.key.name} major · {exercise.timeSignature.join('/')} ·{' '}
              {exercise.notes.length} notes
            </Text>
            <Score exercise={exercise} instrument={instrument} position={position} />
          </section>
        );
      })}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
