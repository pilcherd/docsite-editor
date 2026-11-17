const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs/promises');
const { writeNotices } = require('./notices.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const outdir = path.join(root, 'client/dist');
  await fs.mkdir(outdir, { recursive: true });
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: { editor: 'client/App.jsx', preview: 'client/preview.jsx' },
    outdir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    jsx: 'automatic',
    legalComments: 'external',
    metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
  });
  await fs.copyFile(path.join(root, 'client/loader.js'), path.join(outdir, 'loader.js'));
  const count = await writeNotices(root, result.metafile.inputs);
  console.log('Generated third-party notices for ' + count + ' bundled packages.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
