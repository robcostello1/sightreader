# The detector band, and what it lets us write

The microphone can only name pitches inside a frequency band. The generator has
to know the same band, or it writes notes that score as silence. This is where
the band came from, what it currently is, and what it lets the piano's grand
staff ranges become.

## The band

`PitchyDetector` discards any reading outside `[minHz, maxHz]`, and
`useLesson.ts` constructs it with neither, so the defaults always apply.

Both ends are now measured rather than assumed, by sweeping the detector over
struck-string signals — decaying harmonic stacks, with and without noise at
-20dB and -14dB, which moved neither end.

| | value | note | why |
|---|---|---|---|
| `minHz` | **32.3 Hz** (`DETECTOR_MIN_HZ`) | C1, 32.7 Hz | Every pitch from 1.52 cycles per frame up is named; nothing below 1.43 is. `MIN_PERIODS_IN_FRAME = 1.5`. The old 43 Hz came from a two-cycle rule of thumb and was conservative by five semitones. |
| `maxHz` | **3392 Hz** (`DETECTOR_MAX_HZ`) | G#7, 3322 Hz | Past ~13 samples per period the NSDF peak an octave down is better resolved than the true one, so readings come back exactly an octave flat. G#7 (13.3 samples/period) is named; A7 (12.5) is not. `MIN_SAMPLES_PER_PERIOD = 13`. |

Both are derived from the frame and the sample rate rather than written down, and
the detector recomputes them from the rate the hardware actually granted: at
48kHz the same frame is shorter in time, so C1 stops being nameable there.

That is C1–G#7, 81 semitones, against D2–E6 and 51 before — and 81 of a piano's
88 keys.

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

## The ceiling had the same bug — fixed

`viability.ts` had a floor and no ceiling, so nothing stopped the generator
writing above 1320 Hz. Share of generated notes the detector discarded, at
level 3 — every one of these is now 0.0%:

| instrument / position | pool pitches above E6 | notes discarded |
|---|---|---|
| Piccolo | 20 of 35 | **60.5%** |
| Soprano recorder | 10 of 27 | 34.8% |
| Flute | 8 of 37 | 11.8% |
| Piano / Grand staff, wide | 8 of 57 | 3.6% |
| Violin | 5 of 39 | 3.4% |
| Clarinet in B♭ | 6 of 45 | 3.1% |
| Oboe | 1 of 32 | 0.7% |

`viability.ts` gained `resolutionCeilingHz`, from the same shared constant as
the floor, so the generator stops writing above the band as well as below it.
Every instrument now generates nothing the microphone cannot hear.

## Staff-symmetric grand staff ranges — done

The piano's grand ranges are lopsided when measured in ledger lines rather than
semitones, which is why exercises show notes far above the treble staff and
almost never below the bass staff — see `note-distribution.md` §1.

They were lopsided when measured in ledger lines rather than semitones, which is
why exercises showed unreadable high notes and almost never a note under the
bass clef:

| | was | pitches needing ledgers below | above |
|---|---|---|---|
| grand-close | C3–C6 | 0 (C3 sits inside the bass staff) | 2 (A5, C6) |
| grand-wide | E2–C7 | 1 (E2) | 14, up to 5 lines |

Both are now symmetric about middle C in ledger lines. Ledger lines below the
bass staff run E2, C2, A1, F1; above the treble staff A5, C6, E6, G6.

| | now | low | high | span |
|---|---|---|---|---|
| **grand-close** | 1 ledger line each way | E2 | A5 | 41 semitones |
| **grand-wide** | 3 ledger lines each way | A1 | E6 | 55 semitones |
| **full range** | the whole keyboard, on octave signs | A0 | C8 | 87 semitones |

What that did to the balance, at level 3:

| | bass-staff notes | any bass note | entirely treble |
|---|---|---|---|
| grand-wide, before | 24.1% | 31.2% | 68.8% |
| grand-close, now | 47.7% | 53.5% | 46.5% |
| grand-wide, now | 48.6% | 52.4% | 47.6% |
| full range, now | 44.6% | 46.9% | 53.1% |

Full range writes C1 to G7 of its 88 keys and withholds the rest per note, which
is the band's business rather than the range's: A0–B0 hold too few cycles in one
frame, and above G#7 readings come back an octave flat.

Two things the band decides for the ranges:

- **A1–E6 was the widest staff-symmetric grand range the old band could hear.**
  E6 is 1318.5 Hz, which sat just under the old 1320 Hz ceiling with nothing to
  spare. The measured ceiling leaves room to widen it if that turns out to be
  wanted.
- **Four ledger lines each way is F1–G6.** F1 is 43.7 Hz and G6 is 1568 Hz, both
  now comfortably inside the band, so that range is available whenever three
  lines proves too narrow.
