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

Two ratios carry most of the argument:

- **E/M** — share of notes in the outer 20% of the range against the share in
  the middle 20%. Even coverage is 1.00; above 1 is extremity-heavy.
- **confined%** — share of exercises whose *every* note stays inside the outer
  third at one end. This is the number that matches what the phrase feels like.

---

## 1. The symptom, measured

Level 3, shipped defaults:

| pool | confined% | touches middle third | E/M |
|---|---|---|---|
| Guitar / 5th position | **68.0** | 25.8% | **12.1** |
| Guitar / 12th position | 60.9 | 34.2% | 5.3 |
| Guitar / Open position | 60.1 | 35.2% | 4.2 |
| Bass guitar | 55.7 | 39.9% | 4.0 |
| Guitar / 7th position | 54.9 | 41.1% | 4.7 |
| Piano / Bass staff | 54.4 | 41.6% | 3.4 |
| Piano / Treble staff | 54.0 | 42.1% | 3.4 |
| Violin | 46.0 | 52.1% | 1.3 |
| Piano / Grand staff, wide | 32.7 | 67.3% | 0.6 |
| Guitar / 4th position | 23.2 | 75.8% | **0.5** |
| Guitar / 9th position | 21.9 | 77.1% | 0.7 |

So the hunch is right, and guitar is the worst of it — but it is not "guitar
fixed ranges" as a class. 4th and 9th position lean the *other* way, and there
the busiest quarter of the pool carries 68% of all notes. Which way a position
falls is close to a lottery, and §4 below says what decides it.

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

### 2b. `extremeBias` multiplies whatever shape is already there

`startPitchWeight` gives the range ends 4x the weight of the centre. Turning it
off roughly halves E/M everywhere, and never removes it:

| pool | E/M at bias 0 | E/M at bias 3 |
|---|---|---|
| Guitar / 5th position | 5.21 | 12.08 |
| Guitar / 12th position | 2.10 | 5.33 |
| Guitar / Open position | 1.67 | 4.15 |
| Piano / Treble staff | 1.34 | 3.44 |
| Guitar / 4th position | 0.22 | 0.48 |

On a hole-free pool the bias is the whole story; on a fretted position it is an
amplifier on top of 2a.

Worth noting against spec §3, which asks for weighted starting-pitch selection
*so that* "over many exercises this gives even coverage of the whole region".
The implementation applies a fixed U-shaped weight open-loop and never measures
what comes out — and it is layered on a structural distribution that was
already extremity-heavy. Even at bias 0 the busiest quarter of every pool
carries 41–75% of the notes, against 25% for even coverage.

### 2c. The bias is applied to the first note, which is not symmetric

`choosePlacement` weights `placementPitches(placement)[0]`. Of the sixteen
idioms, nine reach only above their first note and five only below it (`turn`
does both, `repeated-note` neither), and the ascending ones reach further —
`i-v-outline` spans eight degrees up. So an ascending idiom anchored near the
top is rejected outright by the pool test while the same idiom anchored at the
bottom is fine. The high end is therefore reachable only as the *tail* of a
run, never as a boosted anchor — and every hole-free pool comes out
bottom-heavy: open position mean position 0.451, guitar 2nd 0.431, piano bass
staff 0.466, where 0.5 is centred.

Weighting the placement's mean pitch instead does not help; §8 of the report
measures it as slightly worse (open position 3.16 → 3.50).

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
trapezoid instead, and an 11x gap. This is why the wide pools are
middle-heavy in spite of bias 3, and why on grand-wide A4 appears 2.36x the
mean while A#6 appears 0.01x — a ~200x swing between two pitches in the same
pool.

## 3. Outliers

- **Most extremity-skewed**: guitar 5th position in G, and 12th in D — 71.5% of
  notes in the outer 20% of the range, 3.6% in the middle 20% (**20x**).
- **Most middle-skewed**: guitar 4th position in C, and 9th in F — E/M 0.43.
  Across keys, the busiest quarter of 4th position's pool takes 68% of its
  notes, against 25% for even coverage.
- **Widest single-pitch swing**: piano grand-wide, A4 2.36x mean against
  A#6 0.01x.
- **Quietest pitches everywhere** are the accidentals — expected, since the
  level's key set decides them, but within a single key the effective pool at
  level 3 is 13–17 pitches of a nominal 24, which makes every skew above
  sharper than the pool size suggests.

## 4. Key sensitivity — why position alone does not predict the shape

Which holes are diatonic depends on the key, and that alone swings a position
from extremity-heavy to middle-heavy. Guitar, level 3, shipped bias:

| position | C | G | F | D | Bb |
|---|---|---|---|---|---|
| open | 4.08 | 4.09 | 4.12 | 4.13 | 4.66 |
| pos-2 | 2.12 | 4.90 | 0.60 | 4.93 | 0.43 |
| pos-4 | 0.43 | 0.60 | 1.14 | **2.12** | 1.12 |
| pos-5 | 13.48 | **20.12** | 4.93 | 8.12 | 4.90 |
| pos-7 | 4.90 | 4.93 | 2.12 | 13.48 | 0.60 |
| pos-9 | 0.60 | 2.12 | 0.43 | 4.90 | 1.14 |
| pos-12 | 4.93 | **20.12** | 4.90 | **13.48** | 2.12 |

The values repeat exactly across the table because positions are transpositions
of one another: only the offset between the key and the fret pattern matters,
which is a clean confirmation that the driver is structural rather than random.
Open position, with no holes, is flat at ~4.1 in every key.

## 5. What the alternatives are worth

Section 8 of the report enumerates every valid placement and computes the
marginal pitch distribution each weighting would give, with every other roll
held out.

| policy | pos-5 / G, E/M | busiest/quietest |
|---|---|---|
| unweighted | 6.50 | 3.7x |
| first note, bias 1 | 9.86 | 4.8x |
| **first note, bias 3 (shipped)** | **15.52** | **7.9x** |
| bias 3 on placement centre | 15.61 | 7.7x |
| flat per reachable pitch | 4.00 | 1.0x |

Flattening to an even share per reachable pitch is the floor, and it still
leaves E/M at 4.00 — because a severed pool genuinely has fewer usable pitches
near the seam, so "even per pitch" is not "even per semitone". 4.00 is the
structural limit for that configuration, not a shortfall of the policy.

Ordered by value against effort, if this is worth fixing:

1. **`registerWindow` start range.** Clamping starts to `[low - 28, high]` and
   then intersecting with the pool makes every pitch equally reachable. One
   change, removes the 29x gap on piano and the 11x on violin.
2. **Close the loop on the bias.** The spec asks for even coverage over many
   exercises; a fixed U-shaped weight cannot deliver that on a pool whose
   structure already varies 6x from pitch to pitch. Weighting a placement
   against how reachable its pitches actually are — or tracking per-pitch
   counts across a session and weighting down what has been over-used — targets
   the thing the spec actually asked for.
3. **Revisit `extremeBias = 3`.** It roughly doubles E/M everywhere. On pools
   that are already extremity-heavy it is the difference between 5x and 12x.
4. **Decide deliberately what a diatonic hole should do.** Today the idiom is
   silently dropped and the seam empties. The alternatives are to let an idiom
   skip a missing degree, to avoid keys whose degrees fall in a position's
   holes, or to accept the islands and compensate in the weighting — but it
   should be a choice rather than a side effect of `validPlacements`.
