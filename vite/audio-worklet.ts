import { createHash } from 'node:crypto';
import path from 'node:path';
import { rolldown } from 'rolldown';
import type { Plugin } from 'vite';

const SUFFIX = '?audio-worklet';
const DEV_PREFIX = '/@audio-worklet/';

/**
 * Bundles an AudioWorklet entry to a self-contained IIFE and hands back its URL:
 *
 *   import workletUrl from './pitch-processor.ts?audio-worklet';
 *   await ctx.audioWorklet.addModule(workletUrl);
 *
 * Vite's own `?worker&url` cannot be used here. In a production build it emits a
 * self-contained IIFE (which works), but in dev it serves the file unbundled
 * with static `import` statements — and `audioWorklet.addModule()` does not
 * support module imports, so the worklet would load in `vite build` and fail in
 * `vite dev`. Bundling through rolldown in both modes keeps the two identical.
 */
export function audioWorklet(): Plugin {
  /** dev-server URL -> absolute entry path, re-bundled on each request. */
  const devEntries = new Map<string, string>();
  let isBuild = false;

  async function bundle(entry: string, minify: boolean): Promise<string> {
    const build = await rolldown({ input: entry, platform: 'browser' });
    try {
      const { output } = await build.generate({ format: 'iife', minify });
      return output[0].code;
    } finally {
      await build.close();
    }
  }

  return {
    name: 'audio-worklet',

    configResolved(config) {
      isBuild = config.command === 'build';
    },

    async resolveId(source, importer) {
      if (!source.endsWith(SUFFIX)) return null;
      const resolved = await this.resolve(source.slice(0, -SUFFIX.length), importer, {
        skipSelf: true,
      });
      return resolved ? resolved.id + SUFFIX : null;
    },

    async load(id) {
      if (!id.endsWith(SUFFIX)) return null;
      const entry = id.slice(0, -SUFFIX.length);
      const name = path.basename(entry).replace(/\.[cm]?tsx?$/, '.js');

      if (isBuild) {
        const ref = this.emitFile({ type: 'asset', name, source: await bundle(entry, true) });
        return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
      }

      // Dev: hand back a stable URL served by the middleware below.
      const hash = createHash('sha256').update(entry).digest('hex').slice(0, 8);
      const url = `${DEV_PREFIX}${name.replace(/\.js$/, '')}.${hash}.js`;
      devEntries.set(url, entry);
      return `export default ${JSON.stringify(url)};`;
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        const entry = url ? devEntries.get(url) : undefined;
        if (!entry) return next();
        // Re-bundle per request so edits to the worklet (or anything it imports)
        // are picked up by a plain refresh.
        bundle(entry, false).then(
          (code) => {
            res.setHeader('Content-Type', 'text/javascript');
            res.setHeader('Cache-Control', 'no-cache');
            res.end(code);
          },
          (err: unknown) => {
            res.statusCode = 500;
            res.end(`/* audio-worklet bundle failed */\nconsole.error(${JSON.stringify(String(err))});`);
          },
        );
      });
    },

    handleHotUpdate({ file, server }) {
      // The worklet is outside Vite's module graph, so HMR can't see it. A full
      // reload is the only way to get a new processor into the AudioContext.
      if ([...devEntries.values()].includes(file)) {
        server.ws.send({ type: 'full-reload' });
      }
    },
  };
}
