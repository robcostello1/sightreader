# Where generated notes actually land

Phrases feel like they sit at the top or the bottom of a range and rarely in
the middle. They do, and it is measurable. This is what the numbers say, and
which mechanism each part of the effect comes from.

Reproduce with:

```
DISTRIBUTION_REPORT=1 npx vitest run src/generator/distribution.report.test.ts
```

That writes `distribution-report.txt`. `RUNS=` sets the sample size (3000
exercises per configuration below), `OUT=` the destination. The harness is
skipped by `npm test`; it is a measuring instrument, not an assertion suite.

**What changed since this was first measured.** The lean applied to
starting-pitch choice, `extremeBias = 3`, is now `rangeBias`, read as what an
extreme of the range is worth against its centre — 1 is even, above 1 leans to
the edges, below 1 to the middle — and it defaults to **1**. Nothing else in
the generator has changed, so causes 2a, 2c and 2d below are all still live.
Figures are given at the new default unless they say otherwise; `rangeBias 4`
reproduces the old shipped lean.

Two ratios carry most of the argument:

- **E/M** — share of notes in the outer 20% of the range against the share in
  the middle 20%. Even coverage is 1.00; above 1 is extremity-heavy.
- **confined%** — share of exercises whose *every* note stays inside the outer
  third at one end. This is the number that matches what the phrase feels like.

---

## 1. The symptom, measured

Level 3. `confined` is shown both ways: under the lean this generator used to
ship with, and at the neutral default it ships with now. The remaining columns
are at the new default.

| pool | confined, bias 4 (was) | confined, bias 1 (now) | touches middle third | E/M |
|---|---|---|---|---|
| Guitar / 5th position | **68.0%** | **55.5%** | 40.1% | 5.21 |
| Guitar / 12th position | 60.9% | 45.8% | 51.2% | 2.10 |
| Guitar / Open position | 60.1% | 45.0% | 52.2% | 1.67 |
| Bass guitar | 55.7% | 42.5% | 55.0% | 1.66 |
| Guitar / 7th position | 54.9% | 39.4% | 58.6% | 1.90 |
| Piano / Bass staff | 54.4% | 39.6% | 58.2% | 1.34 |
| Piano / Treble staff | 54.0% | 39.6% | 58.2% | 1.34 |
| Violin | 46.0% | 35.4% | 63.9% | 0.63 |
| Piano / Grand staff, wide | 32.7% | 29.3% | 70.7% | 0.45 |
| Guitar / 4th position | 23.2% | 16.5% | 83.1% | **0.22** |
| Guitar / 9th position | 21.9% | 15.4% | 84.3% | 0.33 |

So the hunch is right, and guitar is the worst of it — but it is not "guitar
fixed ranges" as a class. 4th and 9th position lean the *other* way, and there
the busiest quarter of the pool carries 75% of all notes. Which way a position
falls is close to a lottery, and §4 below says what decides it.

Neutralising the lean is worth 10–15 points of `confined` across the board —
real, and not the whole story. Guitar 5th position still confines more than
half its exercises to one end of the range, which is what §2a is about.

## 2. Four causes, separable

### 2a. Fretboard holes sever the diatonic ladder — guitar only, largest effect

A position reaches a *set* of pitches, not a span. Every position but open
covers 24 pitches across 27 semitones, leaving 4 semitones unreachable:

```
pos-2   A#2 D#3 G#3 F4        pos-7   D#3 G#3 C#4 A#4
pos-4   C3  F3  A#3 G4        pos-9   F3  A#3 D#4 C5
pos-5   C#3 F#3 B3  G#4       pos-12  G#3 C#4 F#4 D#5
```

`validPlacements` requires every pitch of an idiom to be in the pool, so when a
hole lands on a degree of the current key, no idiom can span it and the pool
breaks into islands. 5th position in C major loses B3; in G major it loses F#3
*and* B3. The seam then empties out.

Structural coverage shows this before any randomness enters — valid placements
covering each pitch, 5th position, C major, no weighting at all:

```
F3  129   ####################################
G3   81   #######################
A3   84   ########################
C4   84   ########################
D4   81   #######################
E4  129   ####################################
```

Open position has no holes, and its coverage is a clean plateau.

### 2b. The lean multiplies whatever shape is already there — addressed

`startPitchWeight` gave the range ends 4x the weight of the centre. Removing
that lean roughly halves E/M everywhere, and never removes it:

| pool | leaning to the middle (0.25) | even (1, now) | leaning to the edges (4, was) |
|---|---|---|---|
| Guitar / 5th position | 2.66 | 5.21 | 11.94 |
| Guitar / 12th position | 1.01 | 2.10 | 4.94 |
| Guitar / Open position | 0.80 | 1.67 | 3.86 |
| Piano / Treble staff | 0.63 | 1.34 | 3.25 |
| Guitar / 4th position | 0.10 | 0.22 | 0.46 |

Each step of the dial is worth roughly a factor of two, in either direction. On
a hole-free pool the lean was the whole story; on a fretted position it was an
amplifier on top of 2a, which is why 5th position still sits at 5.21 with the
dial neutral.

This is what the change of default rests on. Spec §3 asks for weighted
starting-pitch selection *so that* "over many exercises this gives even
coverage of the whole region". A fixed U-shaped weight applied open-loop cannot
deliver that — it never looks at what comes out — and here it sat on top of a
structural distribution that was already extremity-heavy, so it pushed the same
way rather than correcting. Even with the dial neutral the busiest quarter of
every pool carries 41–75% of the notes against 25% for even coverage, so the
dial was never the mechanism that could deliver §3 in the first place.

### 2c. The bias is applied to the first note, which is not symmetric

`choosePlacement` weights `placementPitches(placement)[0]`. Of the sixteen
idioms, nine reach only above their first note and five only below it (`turn`
does both, `repeated-note` neither), and the ascending ones reach further —
`i-v-outline` spans eight degrees up. So an ascending idiom anchored near the
top is rejected outright by the pool test while the same idiom anchored at the
bottom is fine. The high end is therefore reachable only as the *tail* of a
run, never as a boosted anchor — and every hole-free pool comes out
bottom-heavy even with the dial neutral: open position mean position 0.480,
guitar 2nd 0.456, piano bass staff 0.489, where 0.5 is centred.

Weighting the placement's mean pitch instead does not fix it; §8 of the report
measures it as no better than weighting the first note.

### 2d. `registerWindow` starves the ends of wide pools — the opposite outlier

For a pool wider than 28 semitones the window start is drawn uniformly from
`[low, high - 28]`, so a pitch is reachable only by the windows that happen to
span it. Coverage comes out triangular rather than flat — and on grand-wide,
which is twice the window's width, exactly one pitch is reachable from every
window:

```
Piano / Grand staff, wide (29 window starts)
  E2   P=0.034  #
  A2   P=0.207  ########
  D3   P=0.379  ###############
  G#4  P=1.000  ########################################
  D6   P=0.379  ###############
  C7   P=0.034  #
```

E2 is inside 3.4% of windows and G#4 is inside all of them — a **29x**
availability gap. Violin, being only 10 semitones wider than the window, gets a
trapezoid instead, and an 11x gap. This is why the wide pools come out
middle-heavy whichever way the lean is set: neutralising the lean does not
touch the window at all.

Measured on two naturals, so the key set cannot confound it, grand-wide writes
A4 **38.8x** as often as E2 — availability alone predicts 28.0x, and the
remaining 1.4x is the boundary squeeze below. In 3000 exercises only 11 contain
E2 at all, and only 7 contain C7.

The pool's widest single-pitch swing is larger still, G4 against F#2 at 370x,
but that one is *two* effects multiplied and should not be laid at the window's
door: F# is diatonic only in G major, which level 3 draws 6% of the time.
Separating them on matched pairs — F#4 against A4, whose availability is
near-identical at 0.931 and 0.966, differ by 18.0x, which is all key — gives
9.3x (window, for that pair) x 18.0x (key) x 2.2x (squeeze) = the 370x
observed. The window is one factor of three.

## 3. Outliers

- **Most extremity-skewed**: guitar 5th position in G, and 12th in D — 57.8%
  of notes in the outer 20% of the range against 7.3% in the middle 20%
  (**7.9x**). Under the old lean it was 71.5% against 3.6%, or 20x.
- **Most middle-skewed**: guitar 4th position in C, and 9th in F — E/M 0.21.
  Across keys, the busiest quarter of 4th position's pool takes 75% of its
  notes, against 25% for even coverage.
- **Widest single-pitch swing**: piano grand-wide, G4 against F#2 — **370x**.
  Two causes multiplied, not one: the register window and the key set. On
  matched naturals the window alone is 38.8x (E2 against A4).
- **Quietest pitches everywhere** are the accidentals — expected, since the
  level's key set decides them, but within a single key the effective pool at
  level 3 is 13–17 pitches of a nominal 24, which makes every skew above
  sharper than the pool size suggests.

## 4. Key sensitivity — why position alone does not predict the shape

Which holes are diatonic depends on the key, and that alone swings a position
from extremity-heavy to middle-heavy. Guitar, level 3, shipped bias:

| position | C | G | F | D | Bb |
|---|---|---|---|---|---|
| open | 1.71 | 1.71 | 1.71 | 1.71 | 2.05 |
| pos-2 | 0.96 | 2.02 | 0.31 | 2.02 | 0.21 |
| pos-4 | **0.21** | 0.31 | 0.56 | 0.96 | 0.56 |
| pos-5 | 6.11 | **7.95** | 2.02 | 3.77 | 2.02 |
| pos-7 | 2.02 | 2.02 | 0.96 | 6.11 | 0.31 |
| pos-9 | 0.31 | 0.96 | 0.21 | 2.02 | 0.56 |
| pos-12 | 2.02 | **7.95** | 2.02 | **7.95** | 0.96 |

A 38-fold spread between the best and worst cell, with the dial already
neutral. Under the old lean it was 47-fold, from 0.43 to 20.12.

The values repeat exactly across the table because positions are transpositions
of one another: only the offset between the key and the fret pattern matters,
which is a clean confirmation that the driver is structural rather than random.
Open position, with no holes, is flat at 1.71 in every key but B flat.

## 5. What the alternatives are worth

Section 8 of the report enumerates every valid placement and computes the
marginal pitch distribution each weighting would give, with every other roll
held out.

| policy | pos-5 / G, E/M | busiest/quietest |
|---|---|---|
| **even — rangeBias 1 (now)** | **6.50** | **3.7x** |
| first note, rangeBias 2 | 9.64 | 4.6x |
| first note, rangeBias 4 (was shipped) | 14.71 | 7.1x |
| rangeBias 4 on placement centre | 14.21 | 6.7x |
| flat per reachable pitch | 4.00 | 1.0x |

Flattening to an even share per reachable pitch is the floor, and it still
leaves E/M at 4.00 — because a severed pool genuinely has fewer usable pitches
near the seam, so "even per pitch" is not "even per semitone". 4.00 is the
structural limit for that configuration, not a shortfall of the policy.

Ordered by value against effort. Item 3 is done; the rest are open:

1. **`registerWindow` start range.** Clamping starts to `[low - 28, high]` and
   then intersecting with the pool makes every pitch equally reachable. One
   change, removes the 29x gap on piano and the 11x on violin.
2. **Close the loop on the bias.** The spec asks for even coverage over many
   exercises; a fixed U-shaped weight cannot deliver that on a pool whose
   structure already varies 6x from pitch to pitch. Weighting a placement
   against how reachable its pitches actually are — or tracking per-pitch
   counts across a session and weighting down what has been over-used — targets
   the thing the spec actually asked for.
3. ~~**Revisit `extremeBias = 3`.**~~ Done — it is now `rangeBias`, defaulting
   to 1. The dial remains for a deliberate lean either way, including towards
   the centre where an instrument's idiom warrants it, but it should be set
   against a measurement rather than assumed.
4. **Decide deliberately what a diatonic hole should do.** Today the idiom is
   silently dropped and the seam empties. The alternatives are to let an idiom
   skip a missing degree, to avoid keys whose degrees fall in a position's
   holes, or to accept the islands and compensate in the weighting — but it
   should be a choice rather than a side effect of `validPlacements`.
