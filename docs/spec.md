# Sight-Reading Trainer — Design Spec

## 1. Overview

A browser-based sight-reading trainer. The player is shown notated music,
plays it on their own instrument, and the app listens via microphone to score
pitch and rhythm accuracy. Everything runs
**client-side** for v1 (no backend, no account system, no server round-trip)
to keep latency low for real-time audio feedback.

Core learning philosophy: sight-reading fluency is driven largely by
**pattern recognition ("chunking")** rather than note-by-note pitch lookup.
Expert readers recognize recurring melodic/harmonic shapes (scale runs,
arpeggios, cadential figures) rather than decoding each note in isolation.
The app should therefore be built around a small, reusable **idiom library**
that recurs across many exercises, rather than fully random note generation.

Scope for this phase: **simple and medium difficulty tiers**, monophonic
playing, no singing, no backend, no accounts.

---

## 2. Lesson structure

Every exercise follows the same shape:

```
[ Count-in ]  →  [ Chunk of notated music ]
```

- **Count-in**: establishes tempo before notes begin. Length scales with
  time signature (default: one full bar). Provides the scheduler's reference
  timestamp (t0) for computing all subsequent note-window boundaries.
  - Metronome click during count-in always on.
  - Click continuing through the exercise itself is a **difficulty-tier
    setting**: on for Simple, optionally fading out by Medium.
  - Notes played during the count-in should be ignored/flagged as a false
    start, not scored.

### Difficulty tiers (this phase covers Simple → Medium)

| Tier | Length | Rhythmic values | Key / accidentals | Idiom mixing | Rhythm devices |
|---|---|---|---|---|---|
| **Simple** | 1 idiom, single breve/whole note | Whole notes only | 1 key (start with C major), no accidentals | Single idiom instance | None |
| **Medium** | 2 bars, mixed idioms | Down to quavers (eighth notes) | Home key + occasional accidental (chromatic passing tone / borrowed note) | Multiple idioms per exercise, transposed instances | Some rests, some triplets |
| *(Hard — out of scope for now, noted for future extension)* | 4 bars | Any value incl. tuplets, ties | Any accidental, modulation-like transposition | Freely mixed idioms | Full mix: rests, tuplets, ties |

Idiom complexity and rhythmic density are **independent dials** — e.g. it
should be possible to configure "simple idioms at quaver speed" separately
from "medium idioms at whole-note speed," to isolate whether a learner
struggles with pattern-reading vs. keeping tempo.

---

## 3. Fretboard region model

- **v1 region**: all 6 strings, open position (open strings + first few
  frets). This gives a wide pitch pool immediately.
- Higher positions (e.g. 5th position) are **future regions**, unlocked
  later as separate progression tracks — not in scope for this build, but
  the region data model should anticipate them (see §6).
- **Two independent constraints govern note selection within a region**:
  1. **Pool constraint** — the full set of eligible pitches for the region
     (e.g. all notes reachable in open position across all 6 strings).
  2. **Local movement constraint** — max interval size allowed between
     *consecutive* notes within a single idiom instance. This is what keeps
     early exercises readable even though the overall pool is wide.
     - Simple tier: steps and small thirds only.
     - Medium tier: wider intervals permitted, but still idiom-scoped (an
       arpeggio idiom's leaps are "idiomatic," not just any large jump).
- **Starting-pitch selection should be weighted, not uniform-random**,
  across the pool — deliberately over-sample pitches near the extremes of
  the range (low E/A strings, high B/E strings) since these are typically
  weakest for beginners and often involve ledger lines in standard
  notation. Over many exercises this gives even coverage of the whole
  region without making any single exercise hard to read.
- Fretboard-region difficulty and rhythmic-density difficulty should be
  **gated independently per region**: a region can be introduced at
  breve/whole-note speed and later unlock faster note values within that
  same region as accuracy improves, rather than only ever widening the
  pitch range. (This directly ties into the mastery/progression model in
  §7.)

---

## 4. Idiom library

Idioms are stored as **relative patterns** (scale degrees + rhythmic
values), not absolute pitches, so any idiom can be:
- Instantiated in any key
- Transposed to start on any scale degree within the current region's pool
- Rendered at different rhythmic densities (same shape, different note
  values) as difficulty increases

### Starting idiom set (small and deliberately reused)

**Scalar idioms**
- Ascending/descending stepwise run (3–5 notes, diatonic)
- Neighbor-tone figure (step up then back down, or vice versa)
- Turn figure (upper neighbor, lower neighbor, resolve)

**Arpeggio / broken-chord idioms**
- Triad up (root–3rd–5th)
- Triad down
- Broken triad (e.g. root–3rd–root–5th alternating pattern)
- Simple I–V or I–IV–V outline (medium tier, once transposition is active)

**Interval-based idioms**
- Repeated note (pure rhythm drill, zero pitch difficulty)
- Alternating two-note figure (e.g. 3rds)
- Leap-and-step-back (leap of a 4th/5th, resolve by step)

**Cadential idioms**
- Short "landing" figure at phrase ends (e.g. step down to tonic) to give
  generated phrases musical shape rather than an arbitrary stop.

Generator logic for a Medium exercise: select 2–4 idiom instances, pick
transposed starting points respecting the pool + local-interval
constraints, sequence them (optionally ending with a cadential idiom),
assign rhythmic values per the tier's allowed set, sprinkle in permitted
rests/triplets/accidentals per tier rules.

---

## 5. Audio pipeline (client-side)

### Capture
- `getUserMedia` → `AudioContext` → **`AudioWorkletNode`** (not
  `ScriptProcessorNode` — runs on the audio thread, avoids UI-thread jank).

### Pitch detection
- **v1 algorithm: YIN or pYIN** via a JS/WASM library — no neural model,
  no bundle weight, fast enough to run every ~10–20ms hop.
  - Candidate library: `pitchy` (pure TS, autocorrelation-based, minimal
    integration) — good default starting point.
  - Alternative: `aubio.js` (WASM) if a proper YIN implementation with
    bundled onset detection is preferred.
- Emit `{ pitch, confidence, timestamp }` samples from the worklet back to
  the main thread / app state on each hop.
- **Confidence-gate samples**: only count high-confidence readings as
  "votes" during scoring; low-confidence/unvoiced frames should be
  excluded, not counted as wrong-pitch misses.
- Neural fallback (CREPE-tiny / SwiftF0) and polyphonic detection
  (BasicPitch, for accidental double-stops) are **explicitly deferred** —
  not needed for this phase. Leave a clean seam to swap in a heavier
  detector later without touching the scoring logic.

### Onset detection
- Needed to establish the note-window clock in combination with the
  scheduled tempo (see §6). Spectral-flux / energy-based onset detection is
  standard and works well for a plucked or picked transient.
- Attack sharpness differs meaningfully between instruments — a distorted
  electric against a fingerstyle acoustic, either against a bowed string or a
  flute — so onset sensitivity should be tunable/tested separately per
  instrument type rather than one fixed global threshold.

---

## 6. Rhythm + pitch scoring: windowed occupancy model

Rather than judging exact onset-to-the-millisecond timing, each note is
evaluated over its **expected rhythmic duration window**, computed from
tempo + note value + the count-in's reference timestamp.

### Per-note window scoring algorithm
1. Compute expected start/end timestamp for the note's window from the
   tempo clock.
2. **Exclude the first ~30–50ms of the window** from scoring (attack
   transient / pick noise / pitch-detector settling time) — this avoids
   penalizing well-timed players before the detector has locked on.
3. Over the remaining "scoring zone," collect all high-confidence pitch
   samples.
4. Compute **occupancy %**: fraction of scoring-zone samples whose detected
   pitch matches the target note.
5. **Binary pass/fail against a threshold** (default: ~60–70% occupancy,
   tunable). No partial/graded credit in v1.
6. Distinguish two fail modes internally even though both surface as "fail"
   in v1 UI (useful for future diagnostic feedback):
   - **Silence** — no confident pitch detected in the window at all.
   - **Wrong pitch** — a confident pitch was detected, but it didn't match
     the target.

### Edge cases to handle
- **Short note values** (e.g. quavers at fast tempo) may have very few
  samples in their scoring zone — consider a minimum-sample-count floor
  below which the window is deemed too short to reliably score with the
  current polling rate (this also effectively caps the fastest tempo/note
  combination the app can score).
- **Rests**: score as "did prior note's pitch stop ringing," not "was a
  specific pitch present." Decide whether sustain-through-a-rest should be
  penalized in v1 (recommend: not penalized initially, revisit later).
- **String bleed / accidental double-stops**: if a window shows conflicting
  simultaneous pitches (e.g. an adjacent open string ringing), flag as
  "unclear" rather than silently mis-scoring. A cheap v1 heuristic:
  check spectral flatness / inharmonicity of the signal as a proxy for
  "more than one string is sounding," without full polyphonic transcription.

### UI feedback timing
- Because scoring only resolves at window-close, show a **live/unscored
  pitch indicator** during the window for responsiveness, then confirm
  pass/fail once the window closes. Avoid a single fully-delayed verdict —
  it will feel laggy, especially at faster tempos.

---

## 7. Progression / mastery model

- Track per-region, per-rhythmic-density accuracy (using the pass/fail
  occupancy scores as the mastery signal — no separate scoring system
  needed).
- Gate advancement on two independent axes:
  1. **Density increase** within the current region (e.g. open position:
     whole notes → halves → quavers) as accuracy improves.
  2. **Region unlock** (future: higher fretboard positions) once the
     current region is solid across its density tiers.
- Idiom complexity (Simple idiom set vs. Medium mixed idioms) can also be
  gated somewhat independently of raw rhythmic density, per §2.

---

## 8. Music sourcing

- **v1: procedural generation only**, using the idiom library + region/
  interval constraints described above. This gives full control over
  difficulty and is the fastest path to a working core loop.
- **Future (out of scope now)**: blend in real repertoire via public-domain
  MusicXML/MIDI corpora (Mutopia Project, IMSLP, MuseScore CC0-filtered
  library) for later/advanced tiers, and/or Markov-chain or grammar-based
  generation trained on real melodic patterns for more idiomatic variety
  than pure procedural idiom-mixing.

---

## 9. Explicit non-goals for this phase

- No singing / voice input.
- No neural pitch models (CREPE, SwiftF0) or polyphonic transcription
  (BasicPitch) — deferred, but keep the pitch-detection module swappable.
- No Hard difficulty tier (4-bar, full tuplets/ties/any accidental).
- No backend, accounts, or persistence beyond in-session state (or simple
  local storage if convenient).
- No higher-fretboard-position regions yet — open position, all 6 strings
  only.
- No graded/partial scoring — binary pass/fail per note window only.

---

## 10. Suggested build order

1. Audio pipeline: mic capture → AudioWorklet → YIN/pYIN pitch stream with
   confidence values (`pitchy` recommended starting point).
2. Onset detection (spectral flux) sufficient to validate note-window
   timing.
3. Tempo/count-in scheduler producing note-window timestamps.
4. Windowed occupancy scorer (pass/fail) consuming the pitch stream against
   scheduled windows.
5. Idiom data model (relative-pattern representation) + a handful of
   idioms from §4, hardcoded to start.
6. Procedural exercise generator: pool + local-interval constraints +
   idiom instantiation + weighted starting-pitch selection.
7. Notation rendering (staff display) for generated exercises.
8. Difficulty tier config (Simple, Medium) wiring together generator
   constraints + scoring thresholds + count-in/click behavior.
9. Basic UI: live pitch indicator, per-note pass/fail feedback, lesson
   flow (count-in → chunk → results).
