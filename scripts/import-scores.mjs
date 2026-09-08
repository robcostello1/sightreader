/**
 * Turns a folder of MusicXML scores into excerpts for review.
 *
 *   node scripts/import-scores.mjs <folder> [out.json]
 *
 * Reads .mxl (zipped MusicXML) and .musicxml/.xml, cuts each score into short
 * excerpts, classifies each as lead, bass or mixed, and writes them as JSON for
 * the review page to draw.
 *
 * Nothing it reads or writes belongs in this repository. Scores are somebody
 * else's work and their licensing has to be established per file — the summary
 * this prints reports what each file claims, which is a starting point and not
 * an answer. See docs/excerpt-import.md.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

/*
 * The pipeline is the app's own TypeScript, loaded through Vite rather than
 * copied: node cannot resolve the extensionless imports the source uses, and
 * two implementations of the same parser is how they drift apart.
 */
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const { parseMusicXml } = await vite.ssrLoadModule('/src/content/musicxml.ts');
const { excerptsFrom } = await vite.ssrLoadModule('/src/content/excerpts.ts');

const [, , folder, out = 'excerpts.json'] = process.argv;
if (!folder) {
  console.error('usage: node scripts/import-scores.mjs <folder> [out.json]');
  process.exit(1);
}
void pathToFileURL;

/** .mxl is a zip with the score inside; unzip is the one tool every mac has. */
function readScore(path) {
  if (extname(path) !== '.mxl') return readFileSync(path, 'utf8');
  const listing = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name.endsWith('.xml') && !name.startsWith('META-INF'));
  if (listing.length === 0) throw new Error('no score inside the archive');
  return execFileSync('unzip', ['-p', path, listing[0]], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

const files = readdirSync(folder)
  .filter((name) => ['.mxl', '.musicxml', '.xml'].includes(extname(name)))
  .sort();

const excerpts = [];
const rights = [];
for (const name of files) {
  try {
    const xml = readScore(join(folder, name));
    const document = new JSDOM(xml, { contentType: 'application/xml' }).window.document;
    const score = parseMusicXml(document);
    rights.push({ file: name, title: score.title, composer: score.composer, rights: score.rights });
    excerpts.push(...excerptsFrom(score, { bars: 4, stride: 4, source: basename(name, extname(name)) }));
  } catch (cause) {
    console.warn(`skipped ${name}: ${cause instanceof Error ? cause.message : cause}`);
  }
}

writeFileSync(out, `${JSON.stringify({ excerpts }, null, 2)}\n`);

const claimed = rights.filter((entry) => /public domain/i.test(entry.rights ?? '')).length;
console.log(`${files.length} files, ${excerpts.length} excerpts → ${out}`);
console.log(
  `rights: ${claimed} claim public domain, ${rights.filter((e) => e.rights).length - claimed} claim something else, ` +
    `${rights.filter((e) => !e.rights).length} say nothing at all`,
);
for (const entry of rights.filter((e) => e.rights && !/public domain/i.test(e.rights))) {
  console.log(`  ${entry.file}: ${entry.rights}`);
}

await vite.close();
