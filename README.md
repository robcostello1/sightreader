# Sightreader

A browser-based sight-reading trainer for guitar. The player is shown notated
music, plays it on a real instrument, and the app listens via microphone to
score pitch and rhythm accuracy.

Everything runs client-side — no backend, no accounts, no server round-trip —
to keep latency low for real-time audio feedback.

The design philosophy is that sight-reading fluency comes from **pattern
recognition (chunking)** rather than note-by-note pitch lookup, so exercises
are generated from a small, deliberately reused **idiom library** rather than
random notes. See `docs/spec.md` for the full design.

## Status

Build order steps 1-7 are done: the audio pipeline (pitch + onset), the
tempo/count-in scheduler, the windowed occupancy scorer, the idiom library, the
procedural exercise generator, and VexFlow notation rendering. The domain types, fretboard region model and
difficulty tier config are in place. Tier wiring and the lesson UI are not yet
implemented.

`npm run dev` gives a live pitch readout (note name, Hz, cents, confidence)
to sanity-check the pipeline against a real guitar.

## Getting started

Requires Node `^20.19.0 || >=22.12.0` — Vite 8 and Vitest 4 ship native
bindings that npm silently skips on older Node, leaving a broken install. The
version is pinned in `.nvmrc`:

```sh
nvm use
```

```sh
npm install
npm run dev        # dev server; /preview.html renders notation samples
npm test           # unit tests
npm run typecheck  # tsc, no emit
npm run build      # production build
```

Microphone access requires a secure context. `localhost` counts, so `npm run
dev` works without extra setup.

To use it from another device on your network, run `npm run dev:lan`. Plain
HTTP is *not* a secure context off localhost, so the microphone would be
blocked outright — that script serves over HTTPS with a self-signed
certificate, which the browser will warn about once per device.

## Layout

| Path | Purpose |
|---|---|
| `src/lib/` | Shared domain types and pitch/frequency conversion |
| `src/config/` | Fretboard regions and difficulty tier config |
| `src/audio/` | Mic capture, AudioWorklet, pitch + onset detection |
| `src/scheduler/` | Count-in, tempo clock, note-window timestamps |
| `src/scoring/` | Windowed occupancy scorer (binary pass/fail) |
| `src/idioms/` | Relative-pattern idiom library |
| `src/generator/` | Procedural exercise generation |
| `src/notation/` | VexFlow staff rendering (layout is ours, engraving is VexFlow's) |
| `src/ui/` | Lesson flow and feedback |
| `vite/` | Build plugins (AudioWorklet bundling) |

## Build order

1. ~~Audio pipeline — mic → AudioWorklet → pitch stream with confidence values~~ ✅
2. ~~Onset detection (spectral flux)~~ ✅
3. ~~Tempo/count-in scheduler producing note-window timestamps~~ ✅
4. ~~Windowed occupancy scorer consuming the pitch stream~~ ✅
5. ~~Idiom data model + a handful of hardcoded idioms~~ ✅
6. ~~Procedural exercise generator~~ ✅
7. ~~Notation rendering~~ ✅
8. ~~Difficulty tier wiring~~ ✅
9. ~~Lesson UI~~ ✅

## Difficulty

Ten levels on a **fractional** dial (3.0, 3.1, … 3.9, 4.0). Across levels the
settled parameters interpolate; *within* a level the newly introduced ones climb
by probability. Reaching a whole level is a real step — its ideas arrive at once
in about a fifth of exercises, enough to notice what changed — and they grow to
every exercise by the next whole level. Availability is rolled per exercise, not
merely weighted: weighting alone does not hold a short note value back, because
once the first idiom has eaten into the bar budget only short candidates fit.

Time signatures widen too — 3/4 from level 5, 6/8 from 8. 6/8 is beamed in
threes and clicked in two dotted-crotchet beats, since it is a different feel
rather than just a different bar length.

Each device arrives at its own level and grows from there: note values get shorter *and* more likely, rests from
level 3, triplets from 4 (quintuplets from 9), transposed sequences from 4,
accidentals from 6, keys widening from level 3, and leaps from 2 to 12
semitones across the range.

Exercises stay short on purpose — two bars at level 1, four from the middle up.
What grows with level is how many notes fit in a bar, not how long you wait to
find out whether you read it right.

**Fretboard position is a separate axis, not part of the level.** Moving up the
neck changes *what* you are practising — the same notes in a new place — rather
than how hard the reading is, so it is chosen independently. Positions are named
for the fret the index finger sits on and span four frets; open position is the
exception, being open strings plus the first four frets.

## Progression

The level advances on its own: **80% mean accuracy across the last 5 exercises
moves you up 0.1**. The window is cleared on each step, so the next one has to
be earned at the difficulty it was set from — a full five exercises at the new
level. The slider still overrides it at any time.

Crossing a **whole** level pauses the session and names what is about to start
appearing, so a new idea is read about before it turns up mid-exercise. Tenth
steps pass without interruption.

Gating uses the pass/fail occupancy scores directly — no separate mastery
signal (spec §7). The threshold is short of perfect on purpose: sight-reading is
meant to be attempted at the edge of fluency, and demanding a clean run would
stall anyone on their first misread note.

## Layout

The exercise and its Start button own the main area; everything else sits in a
sidebar, split into **Config** (level, position, keep going) and **Lesson**
(what you are reading, and what is arriving).

The lesson panel is labelled facts rather than a parameter listing — Notes,
Keys, Motion, Time — then only the concepts mid-adoption, each with how far in
it is. Once something appears in every exercise it stops being news and folds
into the facts. `levelSummary()` still returns the full parameter dump, but only
the dev preview page uses it.

Difficulty is the one setting worth reading first, so it carries visibly more
weight than tempo or position beside it.

Colours are explicit tokens rather than opacity on the foreground: dimming by
opacity makes contrast depend on whatever is behind, and the secondary text was
landing below WCAG AA. `contrast.test.ts` reads the stylesheet and checks every
token against both the page and the card surface at the 4.5:1 threshold, so the
palette cannot regress unnoticed — it has already caught one regression that
passed on white and failed on a card.

The verdict colours (`--pass`, `--fail`, `--unclear`, `--accent`) are read from
the stylesheet by the notation layer too, so a note on the staff and its bar in
the level-up window are the same colour by construction rather than by two lists
happening to agree.

## Session behaviour

Level, position and the auto-advance toggle persist in localStorage, validated
on read — a level saved before the range changed, or a position id since
renamed, falls back rather than breaking.

With "keep going" on, finishing an exercise rolls straight into the next after a
short pause, count-in included. That gap can be held with **Pause** — and only
that gap: an exercise is a continuous reading against a fixed tempo, so there
is no coherent place to stop partway and pick it up again.

**Audio during the count-in is ignored entirely** — not scored, not classified,
not even retained. Samples timestamped before `t0` are dropped as they arrive,
so nothing downstream can act on them. The count-in itself is unchanged: it
still clicks, counts down, and anchors every note window.

The live pitch readout **spells what it hears according to the key in play** —
B flat in a flat key, not A sharp — so the feedback matches what is on the page.
Beside it a waveform shows the input, so it is visible that audio is arriving
even when nothing is confident enough to name. Both run from page load, not
just during an exercise: the microphone session is opened independently of the
lesson, so you can check your tuning or your input level before starting. It is read from an `AnalyserNode`
per animation frame rather than pushed through the worklet's message port —
a waveform only needs the current frame, and nothing about it should cost the
detection path. The microphone session deliberately outlives any
single exercise: reopening it would cost a fresh `getUserMedia` round trip each
time, and a newly created `AudioContext` can only be resumed from a user
gesture — which an automatic advance, by definition, does not have.

## Key design decisions

- **Pitch detection is swappable.** v1 uses YIN/autocorrelation via `pitchy`.
  Heavier neural detectors (CREPE, SwiftF0) and polyphonic transcription are
  deferred, but must drop in behind the `PitchDetector` interface without the
  scorer changing.
- **Scoring is windowed occupancy, not onset-exact.** Each note is judged over
  its expected rhythmic duration window: skip the attack transient, collect
  high-confidence samples, and pass if enough of them match the target.
  Binary pass/fail — no partial credit in v1.
- **Difficulty dials are independent.** Idiom complexity, rhythmic density and
  fretboard region are gated separately, so a learner struggling with
  pattern-reading can be told apart from one struggling with tempo.
- **Notes are spelled by key, not by MIDI number** — B flat in F major, A sharp
  in G. VexFlow places the accidentals itself from the key signature, so we
  never restate what the signature already says.
- **Guitar is written an octave above where it sounds**, on a treble clef
  marked with an 8 below it. The low E string sounds E2 but is written E3.
  Everything else — detection, scoring, the region pool — works in sounding
  pitch; `soundingToWritten` is applied only when spelling a note for the page,
  so the two are never confused.
- **VexFlow hardcodes black glyphs and #444 stave lines** into the SVG, which
  are invisible on a dark background. Neither context styles nor `Stave.setStyle`
  displaces them reliably, so `Score` rewrites those attributes to
  `currentColor` after drawing, leaving the explicit verdict colours alone.
- **The worklet is bundled by a custom plugin**, not Vite's `?worker&url`.
  `addModule()` cannot load a module with `import` statements, and Vite's dev
  server serves workers unbundled — so `?worker&url` works in `vite build` and
  fails in `vite dev`. `vite/audio-worklet.ts` bundles the worklet to a
  self-contained IIFE in both modes. Import it as
  `./pitch-processor.ts?audio-worklet`.
- **Onset thresholds are per-instrument and only synthetically calibrated.**
  Defaults come from synthetic plucks, not real guitars; `ONSET_PRESETS` is the
  tuning knob. Recall degrades when several notes sustain and beat together,
  because the constant flux inflates the adaptive median.
- **Mic input disables `echoCancellation`, `noiseSuppression` and
  `autoGainControl`.** All three are tuned for speech: AGC pumps the level and
  noise suppression mangles the harmonic structure the pitch detector reads.
- **Windows are scored as they close**, not in one pass at the end. A verdict
  cannot exist before its window is over, but waiting for the whole exercise
  would feel laggy, so the live pitch shows immediately and pass/fail lands a
  note later.
- **Notation is code-split.** VexFlow is most of the bundle and nothing is
  notated until a lesson starts, so it loads out of band (213 kB initial vs
  722 kB for notation). We import `vexflow/bravura` rather than `vexflow`,
  which would bundle every music font.

## What is untested

Everything below the microphone. 136 unit tests cover the detector, worklet,
scheduler, scorer, generator, layout and lesson state machine — including
running the real bundled worklet in a Node VM and rendering every generated
exercise through VexFlow in jsdom. But no part of this has been run against a
real guitar, so the following are calibrated on synthetic signals only and
should be expected to need tuning:

- `PitchyDetectorOptions.rmsFloor` (default 0.005) — the most likely thing to
  need adjusting for your input level
- `ONSET_PRESETS` thresholds, per instrument
- `DEFAULT_SCORING.passThreshold` and `confidenceGate`
