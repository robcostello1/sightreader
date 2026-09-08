# Importing repertoire excerpts

Turns folders of MusicXML into short excerpts the app can draw, classified as
lead, bass or mixed, for a human to check. Built for #13.

```sh
npm run import-scores -- <folder-of-scores> public/excerpts.json
npm run dev            # then open /review.html
```

The importer reads `.mxl` (zipped MusicXML) and plain `.musicxml`/`.xml`, cuts
each score into four-bar excerpts, and writes them as JSON. The review page
draws each one with the app's own notation and offers **lead / bass / mixed /
reject**; decisions are kept in `localStorage` and copied out as JSON.

## What it does, and what it cannot

`parseMusicXml` reads pitch, length, staff and voice, and nothing else —
dynamics, slurs, articulation, repeats and layout are dropped. It follows
`<backup>`, which is what lets the second staff of a piano part start where the
first did, and it carries divisions, key and time signature across measures that
restate none of them.

`excerptsFrom` makes one line per staff. A chord is flattened to its outer
voice — the top of the right hand, the bottom of the left — because an exercise
is one note at a time. How many notes that threw away is reported per excerpt as
`notesDropped`, and drives `confidence`.

The classifier is deliberately shallow: **which staff a line came from**, and
whether one voice wrote on both. It does not know which line carries the tune,
and a piece where the melody is in the left hand will be labelled `bass` with
full confidence. That is what the review page is for.

On the 69-score corpus at `musetrainer/library`: 2774 excerpts, of which 2414
are drawable at all (the rest hold lengths no symbol represents, mostly from
tuplets), and 952 are drawable, confident and at least six notes long.

## Licensing: read this before shipping any of it

The candidate corpus in #13 is titled a public domain library. Its files do not
support that:

| what the file says | how many |
|---|---|
| "Public Domain" | 3 |
| something else — a name, a URL, a bare `©` | 6 |
| nothing at all | 60 |

Every file is a MuseScore export, and a MuseScore upload is usually somebody's
**arrangement**. An arrangement carries its own copyright even where the work
underneath it is long out of it, so "Bach" on the cover settles nothing. Some
entries are not what they claim either — the "Chopin" spring waltz is a modern
piece by another composer.

So: nothing imported is committed. `excerpts.json`, `public/excerpts.json` and
`scores/` are ignored, and the importer prints what each file claims so the
question can be asked per file rather than per folder.

## Corpora whose provenance holds up

The importer does not care where the MusicXML came from. These state their
licensing per score rather than per folder:

| source | licence | size | format |
|---|---|---|---|
| [OpenScore Lieder](https://github.com/OpenScore/Lieder) | CC0, stated per score | 1,200+ songs | MusicXML per score |
| [OpenScore String Quartets](https://github.com/OpenScore/StringQuartets) | CC0 | 100+ quartets | MusicXML per score |
| [PDMX](https://github.com/pnlong/PDMX) | filtered on each upload's own CC0 field | 250K+ scores | `.mxl` |
| [KernScores](http://kern.humdrum.org/) | free for research, scholarly provenance | Bach, Beethoven, Chopin, Mozart | `**kern`, converts with `hum2xml` |

The two OpenScore corpora are the direct answer to what sank the one above:
they are MuseScore exports too, but transcribed deliberately from public domain
sources and dedicated CC0 by the transcribers — the arrangement's own copyright
waived rather than assumed.

Not music21's bundled corpus, easy as it is to load: it is licensed by
permission of individual encoders, some non-commercially, with terms varying by
directory.
