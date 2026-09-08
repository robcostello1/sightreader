// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './musicxml';
import { excerptToExercise, excerptsFrom } from './excerpts';

/**
 * A score written here rather than taken from anywhere: two staves, a chord, a
 * backup between the hands, a rest, a tie and an accidental. Nothing in this
 * repository is anyone else's music.
 */
const SCORE = `<?xml version="1.0"?>
<score-partwise>
  <work><work-title>Test Piece</work-title></work>
  <identification>
    <creator type="composer">Nobody</creator>
    <rights>Public Domain</rights>
  </identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>1</fifths></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>A</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff><tie type="start"/></note>
      <note><rest/><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><staff>1</staff><tie type="stop"/></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>6</duration><voice>5</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

const parse = (xml = SCORE) =>
  parseMusicXml(new DOMParser().parseFromString(xml, 'application/xml'));

describe('reading MusicXML', () => {
  it('takes the title, composer and whatever the file claims about rights', () => {
    const score = parse();
    expect(score.title).toBe('Test Piece');
    expect(score.composer).toBe('Nobody');
    expect(score.rights).toBe('Public Domain');
    expect(score.staves).toBe(2);
  });

  it('measures a note in fractions of a whole one, whatever the divisions are', () => {
    // Two divisions to a quarter, so a duration of 2 is a quarter note.
    const [first] = parse().measures;
    expect(first.notes[0].value).toBe(0.25);
    expect(first.notes.at(-1)!.value).toBe(0.75);
  });

  it('reads pitch, including the alteration the key signature does not carry', () => {
    const [first] = parse().measures;
    expect(first.notes[0].midi).toBe(67);
    // A sharp: G#4/A♭ is 70, so A#4 is 70.
    expect(first.notes[2].midi).toBe(70);
  });

  it('keeps a rest as a rest rather than dropping it', () => {
    expect(parse().measures[0].notes[3].midi).toBeNull();
  });

  it('marks a chord as sounding with the note before it, not after', () => {
    const [first] = parse().measures;
    expect(first.notes[1].chord).toBe(true);
    expect(first.notes[1].onset).toBe(first.notes[0].onset);
    expect(first.notes[2].onset).toBe(0.25);
  });

  it('winds the cursor back so the second staff starts where the first did', () => {
    const bass = parse().measures[0].notes.filter((note) => note.staff === 2);
    expect(bass).toHaveLength(1);
    expect(bass[0].onset).toBe(0);
  });

  it('carries the key and time signature into measures that restate neither', () => {
    const [, second] = parse().measures;
    expect(second.timeSignature).toEqual([3, 4]);
    expect(second.fifths).toBe(1);
  });

  it('knows a tie continuing from the note before', () => {
    expect(parse().measures[1].notes[0].tied).toBe(true);
  });

  it('says so plainly when handed something that is not a score', () => {
    expect(() => parse('<html><body>not music</body></html>')).toThrow(/not a partwise/);
  });
});

describe('cutting a score into excerpts', () => {
  const excerpts = () => excerptsFrom(parse(), { bars: 2, source: 'test' });

  it('offers each staff as its own line', () => {
    expect(excerpts().map((e) => e.line)).toEqual(['lead', 'bass']);
  });

  it('flattens a chord to the outer voice: the top up, the bottom down', () => {
    const lead = excerpts()[0];
    // B4 rather than the G4 under it, and one note thrown away to get there.
    expect(lead.notes[0].midi).toBe(71);
    expect(lead.notesDropped).toBe(1);
  });

  it('is less sure of a line the more of the music it had to throw away', () => {
    const [lead, bass] = excerpts();
    expect(bass.confidence).toBe(1);
    expect(lead.confidence).toBeLessThan(1);
  });

  it('carries the key and metre the excerpt starts in', () => {
    expect(excerpts()[0].timeSignature).toEqual([3, 4]);
    expect(excerpts()[0].fifths).toBe(1);
  });

  it('calls a figure that uses both hands mixed, and doubts it', () => {
    const spanning = SCORE.replace(
      '<note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><staff>2</staff></note>',
      '<note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><voice>1</voice><staff>2</staff></note>',
    );
    const found = excerptsFrom(parse(spanning), { bars: 2, source: 'test' });
    expect(found.every((e) => e.line === 'mixed')).toBe(true);
    expect(found.every((e) => e.confidence < 0.5)).toBe(true);
  });

  it('says whether every length in it can be drawn at all', () => {
    expect(excerpts().every((e) => e.notatable)).toBe(true);
  });

  it('reads back as an exercise, in the key the excerpt is in', () => {
    const exercise = excerptToExercise(excerpts()[0]);
    expect(exercise.key.name).toBe('G');
    expect(exercise.timeSignature).toEqual([3, 4]);
    expect(exercise.notes).toHaveLength(excerpts()[0].notes.length);
  });

  it('steps through a longer score rather than taking only the opening', () => {
    const score = parse();
    // Four measures of two-bar excerpts, two staves: four excerpts.
    score.measures = [...score.measures, ...score.measures];
    expect(excerptsFrom(score, { bars: 2, source: 'test' })).toHaveLength(4);
  });
});
