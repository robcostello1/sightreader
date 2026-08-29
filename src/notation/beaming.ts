import { Beam, StaveNote } from 'vexflow/bravura';

/** Durations that carry a beam; anything longer is drawn with a plain stem. */
const BEAMABLE_DURATIONS = new Set(['8', '16', '32', '64']);

function isBeamable(note: StaveNote): boolean {
  return !note.isRest() && BEAMABLE_DURATIONS.has(note.getDuration());
}

/**
 * Beams a bar, keeping each tuplet whole.
 *
 * Beam.generateBeams groups by the ordinary beat divisions and knows nothing
 * about tuplets, so a triplet of quavers comes out beamed 2 + 2 with its last
 * note joined to whatever follows. A tuplet is one beam group by definition, so
 * each is beamed on its own and the runs between them are generated normally.
 *
 * `groups[i]` is the tuplet group id of `notes[i]`, or undefined outside one.
 */
export function beamBar(
  notes: StaveNote[],
  groups: (number | undefined)[],
  timeSignature: [number, number],
): Beam[] {
  // 6/8 beams in threes, 4/4 in beats. VexFlow knows the conventional grouping
  // for each signature, so ask rather than assume crotchet beats.
  const beamGroups = Beam.getDefaultBeamGroups(timeSignature.join('/'));
  const beams: Beam[] = [];
  let segment: StaveNote[] = [];
  let segmentGroup: number | undefined;
  let inTuplet = false;

  const flush = () => {
    if (segment.length === 0) return;
    if (inTuplet) {
      // Left unbeamed when the group holds a rest or a note too long to beam —
      // the bracket alone still reads correctly.
      if (segment.length > 1 && segment.every(isBeamable)) beams.push(new Beam(segment));
    } else {
      beams.push(...Beam.generateBeams(segment, { groups: beamGroups }));
    }
    segment = [];
  };

  notes.forEach((note, index) => {
    const group = groups[index];
    if (group !== segmentGroup) {
      flush();
      segmentGroup = group;
      inTuplet = group !== undefined;
    }
    segment.push(note);
  });
  flush();
  return beams;
}
