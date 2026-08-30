import { Beam, Fraction, StaveNote } from 'vexflow/bravura';
import { drawnValue } from './rests';
import type { NotatedNote } from './layout';

/** Durations that carry a beam; anything longer is drawn with a plain stem. */
const BEAMABLE_DURATIONS = new Set(['8', '16', '32', '64']);

function isBeamable(note: StaveNote): boolean {
  return !note.isRest() && BEAMABLE_DURATIONS.has(note.getDuration());
}

/** Half of a common-time bar, as a fraction of a whole note. */
const HALF_BAR = 0.5;

const EPSILON = 1e-9;

/**
 * A beam over notes chosen by them, not by whichever came first.
 *
 * new Beam(notes) points every stem the way the first note's does, which turns
 * a run above the staff stems-up — and takes the tuplet numeral with it, drawn
 * upside down under the beam. autoStem reads the run as a whole.
 */
function beamOver(notes: StaveNote[]): Beam {
  return new Beam(notes, true);
}

/** Which half of a common-time bar a position falls in. */
function halfBar(position: number): number {
  return Math.floor(position / HALF_BAR + EPSILON);
}

/**
 * Beams one run, which by then lies within a single half bar.
 *
 * Quavers there are printed four to a beam: it shows the two-beat pulse the bar
 * is felt in, and stopping at the half bar keeps beat three visible, which is
 * the beat the eye looks for. So everything beamable in the half bar joins one
 * beam, and generateBeams is not consulted — asked for half-bar groups it drops
 * any run that does not fill one, which is most of them.
 *
 * Anything shorter than a quaver goes back to beat groups, which is how
 * semiquavers are written: eight of them under one beam would be unreadable.
 */
function beamRun(run: StaveNote[], defaults: Fraction[]): Beam[] {
  const quavers = run.every((note) => !isBeamable(note) || note.getDuration() === '8');
  if (!quavers) return Beam.generateBeams(run, { groups: defaults });

  const beams: Beam[] = [];
  let beamed: StaveNote[] = [];
  const flush = () => {
    if (beamed.length > 1) beams.push(beamOver(beamed));
    beamed = [];
  };
  for (const note of run) {
    // A rest or a longer note breaks the beam where it stands.
    if (isBeamable(note)) beamed.push(note);
    else flush();
  }
  flush();
  return beams;
}

/**
 * Beams a bar, keeping each tuplet whole.
 *
 * Beam.generateBeams groups by the ordinary beat divisions and knows nothing
 * about tuplets, so a triplet of quavers comes out beamed 2 + 2 with its last
 * note joined to whatever follows. A tuplet is one beam group by definition, so
 * each is beamed on its own and the runs between them are generated normally.
 *
 * It knows nothing about where in the bar it is, either — it counts ticks from
 * the first note it is handed and skips the ones it cannot beam, so a crotchet
 * followed by six quavers has it start counting at the second note. Common time
 * is therefore split at the half bar here, before it is asked.
 *
 * `source[i]` is the note `notes[i]` was drawn from, which carries both its
 * tuplet membership and its length.
 */
export function beamBar(
  notes: StaveNote[],
  source: readonly NotatedNote[],
  timeSignature: [number, number],
): Beam[] {
  // 6/8 beams in threes, 3/4 in beats. VexFlow knows the conventional grouping
  // for each signature, so ask rather than assume crotchet beats.
  const defaults = Beam.getDefaultBeamGroups(timeSignature.join('/'));
  const common = timeSignature[0] === 4 && timeSignature[1] === 4;

  const positions: number[] = [];
  let at = 0;
  for (const note of source) {
    positions.push(at);
    at += drawnValue(note);
  }

  const beams: Beam[] = [];
  let index = 0;

  while (index < notes.length) {
    const group = source[index]?.tuplet?.group;
    let end = index;
    while (end < notes.length && source[end]?.tuplet?.group === group) end++;

    if (group !== undefined) {
      // Left unbeamed when the group holds a rest or a note too long to beam —
      // the bracket alone still reads correctly.
      const segment = notes.slice(index, end);
      if (segment.length > 1 && segment.every(isBeamable)) beams.push(beamOver(segment));
    } else if (!common) {
      beams.push(...Beam.generateBeams(notes.slice(index, end), { groups: defaults }));
    } else {
      let start = index;
      while (start < end) {
        const half = halfBar(positions[start]);
        let stop = start;
        while (stop < end && halfBar(positions[stop]) === half) stop++;
        beams.push(...beamRun(notes.slice(start, stop), defaults));
        start = stop;
      }
    }

    index = end;
  }

  return beams;
}
