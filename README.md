# Sightreader

A browser-based sight-reading trainer. The player is shown notated music,
plays it on their own instrument, and the app listens via microphone to score
pitch and rhythm accuracy.

Everything runs client-side — no backend, no accounts, no server round-trip —
to keep latency low for real-time audio feedback.

## Running it

Requires Node `^20.19.0 || >=22.12.0` — Vite 8 and Vitest 4 ship native
bindings that npm silently skips on older Node, leaving an install that looks
clean and fails on first run. The version is pinned in `.nvmrc`:

```sh
nvm use
npm install
```

```sh
npm run dev        # dev server; /preview.html renders notation samples
npm test           # unit tests
npm run typecheck  # tsc, no emit
npm run build      # production build
npm run lint       # oxlint
```

Microphone access requires a secure context. `localhost` counts, so `npm run
dev` works without extra setup.

To use it from another device on your network, run `npm run dev:lan`. Plain
HTTP is *not* a secure context off localhost, so the microphone would be
blocked outright — that script serves over HTTPS with a self-signed
certificate, which the browser will warn about once per device.

## Principles

**Reading is pattern recognition, not note lookup.** Fluency comes from
recognising shapes — scale fragments, arpeggios, cadential figures — rather
than decoding each note in isolation. Exercises are therefore generated from a
small, deliberately reused **idiom library** rather than from random notes, so
the same shapes recur often enough to be learnt.

Sequences within an exercise are **diatonic, not transposed**: an idiom repeats
on a new scale degree with its shape preserved in degrees rather than
semitones, so the intervals change to fit the key — a neighbour figure of
F–G–F becomes B–C–B, a tone becoming a semitone. A real sequence would hold the
intervals exact and leave the key; a modulating one would change key outright.
Neither is what a reader at these levels should be meeting.

**Difficulty is one dial, and it moves in tenths.** Ten levels on a fractional
scale (3.0, 3.1, … 3.9, 4.0). Across levels the settled parameters interpolate;
*within* a level the newly introduced ones climb by probability. Reaching a
whole level is a real step — its ideas arrive at once in about a fifth of
exercises, enough to notice what changed — and grow to every exercise by the
next whole level.

Availability is rolled per exercise rather than merely weighted. Weighting
alone cannot hold a short note value back: once the first idiom has eaten into
the bar budget, only short candidates still fit, so a low weight still turns up
everywhere.

Roughly, across the range: quavers from level 5 and semiquavers from 8, and
each grows more likely once it arrives; rests from 3; triplets from 4 and
quintuplets from 9; diatonic sequences from 4; accidentals from 6; keys
widening from 3; and leaps growing from 2 to 12 semitones. Time signatures
widen too — 3/4 from level 4, 6/8 from 7. 6/8 is beamed in threes and clicked
in two dotted-crotchet beats, since it is a different feel rather than just a
different bar length.

Exercises stay short on purpose — two bars at level 1, four from the middle up.
What grows with level is how many notes fit in a bar, not how long you wait to
find out whether you read it right.

**The level advances on its own.** 80% mean accuracy across the last 5
exercises moves you up 0.1. The window is cleared on each step, so the next one
has to be earned at the difficulty it was set from — a full five exercises at
the new level. The slider still overrides it at any time.

Crossing a **whole** level pauses the session and names what is about to start
appearing, so a new idea is read about before it turns up mid-exercise. Tenth
steps pass without interruption.

Gating uses the pass/fail scores directly — there is no separate mastery
signal. The threshold is short of perfect on purpose: sight-reading is meant to
be attempted at the edge of fluency, and demanding a clean run would stall
anyone on their first misread note.

**Which notes you read is a separate axis from how hard they are.** Moving up
the neck, or into a different corner of the keyboard, changes *what* you are
practising — the same reading in a new place — rather than how hard the reading
is, so range is chosen independently of level. Guitar positions are named for
the fret the index finger sits on and span four frets; open position is the
exception, being open strings plus the first four.

**Scoring is windowed occupancy, not onset-exact.** Each note is judged over
its expected rhythmic duration window: skip the attack transient, collect
high-confidence samples, and pass if enough of them match the target. Binary
pass/fail — no partial credit. Windows are scored as they close rather than in
one pass at the end: a verdict cannot exist before its window is over, but
waiting for the whole exercise would feel laggy, so the live pitch shows
immediately and pass/fail lands a note later.

**The count-in is not part of the performance.** Audio during it is ignored
entirely — not scored, not classified, not even retained. Samples timestamped
before `t0` are dropped as they arrive, so nothing downstream can act on them.
The count-in itself still clicks, counts down, and anchors every note window.

**Sounding pitch and written pitch are never confused.** The generator, the
scorer and the microphone all work in concert pitch; transposition is applied
only when notes reach the page — along with the key signature, so a B flat
clarinet reading concert C gets D major and its accidentals agree with the
notes beside them. The live readout names the *written* note too, since a
player thinks in their own part, and spells what it hears according to the key
in play — B flat in a flat key, not A sharp.

**Nothing about the interface should move while you read.** Cards hold fixed
positions and the notation keeps permanent space, so a verdict arriving cannot
reflow the staff under your eyes. Colours are explicit tokens rather than
opacity on the foreground: dimming by opacity makes contrast depend on whatever
is behind it, and the secondary text was landing below WCAG AA. The verdict
colours (`--pass`, `--fail`, `--unclear`, `--accent`) are read from the
stylesheet by the notation layer too, so a note on the staff and its bar in the
level-up panel match by construction rather than by two lists happening to
agree.

## Instruments

Twenty-five instruments across five families. Guitar and piano offer a position
control; everything else has one fixed range. Piano's positions vary which
staves are in play as well as the range, and it is the one instrument drawn on
a grand staff.

Eight instruments are listed but disabled: their sounding range dips below E2,
where pitch detection is not yet proven. That is applied as a rule, not a list
— a test asserts no available instrument sounds lower — and it is a holding
pattern until a note-level viability check replaces it.

## What you see

The exercise and its Start button own the main area, with the live monitor
below it: the note being heard, how the level is progressing, and how the last
exercise scored. Settings and a summary of the current level sit in the
sidebar.

The level summary is labelled facts — Notes, Keys, Motion, Time — followed by
only the concepts mid-adoption, each with how far in it is. Once something
appears in every exercise it stops being news and folds into the facts.
Difficulty is the setting worth reading first, so it carries visibly more
weight than the tempo or range beside it.

Beside the heard note, a waveform shows the input, so it is visible that audio
is arriving even when nothing is confident enough to name. Both run from page
load rather than only during an exercise: the microphone session is opened
independently of the lesson, so you can check your tuning or your input level
before starting.

Level, instrument, range and the auto-advance toggle persist in localStorage,
validated on read — a level saved before the range changed, or a position id
since renamed, falls back rather than breaking. With auto-advance on, finishing
an exercise rolls into the next after a short pause, count-in included. That
gap can be held with **Pause** — and only that gap: an exercise is a continuous
reading against a fixed tempo, so there is no coherent place to stop partway
and pick it up again.

## How it is put together

| Path | Purpose |
|---|---|
| `src/lib/` | Shared domain types and pitch/frequency conversion |
| `src/config/` | Instruments, fretboard regions, level and progression config |
| `src/audio/` | Mic capture, AudioWorklet, pitch + onset detection |
| `src/scheduler/` | Count-in, tempo clock, note-window timestamps |
| `src/scoring/` | Windowed occupancy scorer (binary pass/fail) |
| `src/idioms/` | Relative-pattern idiom library |
| `src/generator/` | Procedural exercise generation |
| `src/notation/` | VexFlow staff rendering (layout is ours, engraving is VexFlow's) |
| `src/ui/` | Lesson flow and feedback |
| `vite/` | Build plugins (AudioWorklet bundling) |

Decisions worth knowing before changing something:

- **Pitch detection is swappable.** It currently uses autocorrelation via
  `pitchy`. Heavier neural detectors and polyphonic transcription are deferred,
  but must drop in behind the `PitchDetector` interface without the scorer
  changing.
- **Mic input disables `echoCancellation`, `noiseSuppression` and
  `autoGainControl`.** All three are tuned for speech: AGC pumps the level and
  noise suppression mangles the harmonic structure the pitch detector reads.
- **The microphone session outlives any single exercise.** Reopening it would
  cost a fresh `getUserMedia` round trip each time, and a newly created
  `AudioContext` can only be resumed from a user gesture — which an automatic
  advance, by definition, does not have. The waveform is read from an
  `AnalyserNode` per animation frame rather than pushed through the worklet's
  message port: it only needs the current frame, and nothing about it should
  cost the detection path.
- **The worklet is bundled by a custom plugin**, not Vite's `?worker&url`.
  `addModule()` cannot load a module with `import` statements, and Vite's dev
  server serves workers unbundled — so `?worker&url` works in `vite build` and
  fails in `vite dev`. `vite/audio-worklet.ts` bundles the worklet to a
  self-contained IIFE in both modes. Import it as
  `./pitch-processor.ts?audio-worklet`.
- **Notes are spelled by key, not by MIDI number** — B flat in F major, A sharp
  in G. VexFlow places the accidentals itself from the key signature, so we
  never restate what the signature already says.
- **VexFlow hardcodes black glyphs and `#444` stave lines** into the SVG, which
  are invisible on a dark background. Neither context styles nor
  `Stave.setStyle` displaces them reliably, so `Score` rewrites those attributes
  to `currentColor` after drawing, leaving the explicit verdict colours alone.
- **Notation is code-split.** VexFlow is most of the bundle and nothing is
  notated until a lesson starts, so it loads out of band — 236 kB initial
  against 727 kB for notation. We import `vexflow/bravura` rather than
  `vexflow`, which would bundle every music font.
- **`contrast.test.ts` reads the stylesheet** and checks every colour token
  against both the page and the card surface at the 4.5:1 threshold, so the
  palette cannot regress unnoticed. It has already caught one that passed on
  white and failed on a card.

## What is untested

Everything below the microphone. The unit tests cover the detector, worklet,
scheduler, scorer, generator, layout and lesson state machine — including
running the real bundled worklet in a Node VM and rendering every generated
exercise through VexFlow in jsdom. But no part of this has been run against a
real instrument, so the following are calibrated on synthetic signals only and
should be expected to need tuning:

- `PitchyDetectorOptions.rmsFloor` (default 0.005) — the most likely thing to
  need adjusting for your input level
- `ONSET_PRESETS` thresholds, per instrument. Defaults come from synthetic
  plucks, not real playing. Recall degrades when several notes sustain and beat
  together, because the constant flux inflates the adaptive median.
- `DEFAULT_VIABILITY` — the pitch/value/tempo gate that keeps notes the
  microphone could not score out of exercises. Built and tested, but shipped
  **off**: its three constants are placeholders, and gating real exercises on a
  guessed margin is either needlessly restrictive or not restrictive enough
  with no way to tell which. Switching it on is one flag once the constants are
  measured.
- `DEFAULT_SCORING.passThreshold` and `confidenceGate`

`docs/spec.md` holds the original design spec, including the parts not built.
