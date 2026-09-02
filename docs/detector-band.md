# The detector band, and what it lets us write

The microphone can only name pitches inside a frequency band. The generator has
to know the same band, or it writes notes that score as silence. This is where
the band came from, what it currently is, and what it lets the piano's grand
staff ranges become.

## The band

`PitchyDetector` discards any reading outside `[minHz, maxHz]`, and
`useLesson.ts` constructs it with neither, so the defaults always apply.

| | value | lowest / highest note | why |
|---|---|---|---|
| `minHz` | **43 Hz** (`DETECTOR_MIN_HZ`) | F1, 43.7 Hz | The frame's own limit: 2048 samples at 44.1kHz spans 46ms, which holds two cycles at 43.07 Hz. E1 (41.2 Hz) is out of reach at any note length. |
| `maxHz` | 1320 Hz | E6, 1318.5 Hz | **Unexamined.** A guitar-era value — "well above open position's top note", which is G#4 at 415 Hz. |

## The floor used to disagree with itself

`minHz` was 70 Hz, a guard sized for the guitar's low E when guitar was the only
instrument, while `viability.ts` told the generator the floor was 43 Hz. The
generator wrote everything above 43 Hz; the detector threw away everything below
70. Nobody saw an error — an unscoreable note simply reads as one the player did
not sound.

It cost the low instruments about an octave each:

| instrument | notes generated the detector discarded |
|---|---|
| Double bass | 28.4% |
| Bass guitar | 28.4% |
| Tuba | 16.5% |
| French horn in F | 9.9% |
| Bassoon | 1.6% |
| Cello | 0.6% |

All of those are now 0.0%. Both places read `DETECTOR_MIN_HZ`, and a test in
`detector.test.ts` holds them equal so they cannot drift again. F1 is confirmed
working against a real piano and microphone.

Note the sample rate: at 48kHz the same frame spans 42.7ms and the true floor is
nearer 47 Hz, so F1 is marginal on hardware that opens at that rate. Sizing the
frame from the live rate is a detector change rather than a constant.

## The ceiling has the same bug, unfixed

`viability.ts` has a floor and no ceiling, so nothing stops the generator writing
above 1320 Hz. Share of generated notes the detector discards, at level 3:

| instrument / position | pool pitches above E6 | notes discarded |
|---|---|---|
| Piccolo | 20 of 35 | **60.5%** |
| Soprano recorder | 10 of 27 | 34.8% |
| Flute | 8 of 37 | 11.8% |
| Piano / Grand staff, wide | 8 of 57 | 3.6% |
| Violin | 5 of 39 | 3.4% |
| Clarinet in B♭ | 6 of 45 | 3.1% |
| Oboe | 1 of 32 | 0.7% |

Three notes in five on a piccolo cannot be scored. Fixing it needs two things,
in this order:

1. **A measurement.** Unlike the floor, 1320 Hz has no derivation behind it —
   the frame resolves far above it. Where readings stop being trustworthy is a
   question for the pitch-detection spike, not for a constant chosen by reading
   the code.
2. **A ceiling in `viability.ts`**, sourced from the same shared constant as the
   floor, so the generator stops writing above whatever the answer is.

## Planned: staff-symmetric grand staff ranges

The piano's grand ranges are lopsided when measured in ledger lines rather than
semitones, which is why exercises show notes far above the treble staff and
almost never below the bass staff — see `note-distribution.md` §1.

| | now | pitches needing ledgers below | above |
|---|---|---|---|
| grand-close | C3–C6 | 0 (C3 sits inside the bass staff) | 2 (A5, C6) |
| grand-wide | E2–C7 | 1 (E2) | 14, up to 5 lines |

The intent is for both to be as symmetric as possible about middle C, counted in
ledger lines:

| | planned | low | high | span |
|---|---|---|---|---|
| **grand-close** | 1 ledger line each way | E2 | A5 | 41 semitones |
| **grand-wide** | 3 ledger lines each way | A1 | E6 | 55 semitones |
| grand-wide, if the ceiling rises | 4 ledger lines each way | F1 | G6 | 62 semitones |

Ledger lines below the bass staff run E2, C2, A1, F1; above the treble staff
A5, C6, E6, G6.

Two things fall out of the band:

- **A1–E6 is exactly the widest staff-symmetric grand range the detector can
  hear today.** A1 is 55 Hz, comfortably over the floor; E6 is 1318.5 Hz, just
  under the ceiling. It fits with nothing to spare at the top.
- **Four ledger lines each way bottoms out at F1, which is precisely the new
  floor** — but its top, G6 at 1568 Hz, is above the current ceiling. So the
  4-line version is gated on the ceiling measurement above, and no wider
  symmetric range than that is reachable at all.

Not yet implemented. Changing the ranges without first fixing the window
starvation in `note-distribution.md` §2d would put the new outer notes in the
most starved positions in the pool, so they would barely appear.
