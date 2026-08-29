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

Scaffold. The domain types, fretboard region model and difficulty tier config
are in place; the audio pipeline, scheduler, scorer, generator and notation
rendering are not yet implemented.

## Getting started

Requires Node `^20.19.0 || >=22.12.0` — Vite 8 and Vitest 4 ship native
bindings that npm silently skips on older Node, leaving a broken install. The
version is pinned in `.nvmrc`:

```sh
nvm use
```

```sh
npm install
npm run dev        # dev server
npm test           # unit tests
npm run typecheck  # tsc, no emit
npm run build      # production build
```

Microphone access requires a secure context. `localhost` counts, so the Vite
dev server works without extra setup.

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
| `src/notation/` | VexFlow staff rendering |
| `src/ui/` | Lesson flow and feedback |
| `public/worklets/` | AudioWorklet processor sources, served at a stable URL |

## Build order

1. Audio pipeline — mic → AudioWorklet → pitch stream with confidence values
2. Onset detection (spectral flux)
3. Tempo/count-in scheduler producing note-window timestamps
4. Windowed occupancy scorer consuming the pitch stream
5. Idiom data model + a handful of hardcoded idioms
6. Procedural exercise generator
7. Notation rendering
8. Difficulty tier wiring
9. Lesson UI

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
