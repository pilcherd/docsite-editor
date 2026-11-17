#!/usr/bin/env node
const path = require('node:path'),
  fs = require('node:fs'),
  { spawn } = require('node:child_process'),
  express = require('express');
const { createApi } = require('../lib/server.cjs'),
  { loadProject } = require('../lib/project.cjs'),
  { readManifest } = require('../lib/manifest.cjs');
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(name + ' requires a value.');
  return args[i + 1];
}
const siteDir = path.resolve(option('--site', process.cwd())),
  port = Number(option('--port', 3000)),
  built = args.includes('--built'),
  configFile = option('--config');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Choose a port between 1024 and 65535.');
const core = path.join(
  path.dirname(require.resolve('@docusaurus/core/package.json', { paths: [siteDir] })),
  'bin/docusaurus.mjs',
);
const environment = { ...process.env, DOCUSAURUS_SITE_EDITOR: '1', BROWSER: 'none' };
let child,
  server,
  rebuilding = false,
  queued = false,
  currentOutput,
  project;
const status = { building: false, error: null, lastBuilt: null },
  output = path.join(siteDir, '.docsite-editor/build');
function run(commandArgs) {
  return new Promise((resolve, reject) => {
    child = spawn(
      process.execPath,
      [core, ...commandArgs, ...(configFile ? ['--config', configFile] : [])],
      {
        cwd: siteDir,
        env: environment,
        stdio: 'inherit',
        detached: process.platform !== 'win32',
        windowsHide: true,
      },
    );
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Docusaurus exited with code ' + code)),
    );
    child.on('error', reject);
  });
}
async function build() {
  if (rebuilding) {
    queued = true;
    return;
  }
  rebuilding = true;
  status.building = true;
  status.error = null;
  const next = path.join(output, 'version-' + Date.now());
  try {
    await run(['build', '--out-dir', next]);
    project = readManifest(await loadProject(siteDir, { configFile }));
    const old = currentOutput;
    currentOutput = next;
    status.lastBuilt = new Date().toISOString();
    if (old && old.startsWith(output + path.sep)) fs.rmSync(old, { recursive: true, force: true });
  } catch (error) {
    status.error = error.message;
    console.error(error.message);
  } finally {
    rebuilding = false;
    status.building = false;
    if (queued) {
      queued = false;
      build();
    }
  }
}
function stop() {
  server?.close();
  if (child?.pid) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
(async () => {
  project = await loadProject(siteDir, { configFile });
  console.log(
    'Local site editor: http://localhost:' +
      port +
      project.baseUrl +
      '\nSave writes to ' +
      siteDir +
      '. Git commits are manual. Ctrl+C stops the editor.',
  );
  if (!built) {
    await run(['start', '--host', '127.0.0.1', '--port', String(port), '--no-open']);
    return;
  }
  await build();
  if (!currentOutput)
    throw new Error(
      'The initial local build failed. Fix the errors above before starting the built-site editor.',
    );
  const app = express();
  app.use(
    createApi({
      siteDir,
      getProject: () => project,
      mode: 'built',
      onSave: () => build(),
      getStatus: () => status,
    }),
  );
  // Serve new static images immediately while the last successful build remains available.
  app.use((req, res, next) => {
    const base = project.baseUrl.replace(/\/$/, '');
    if (base && !req.path.startsWith(base + '/')) return next();
    const route = base ? req.path.slice(base.length) : req.path;
    let index = 0;
    function serve() {
      const root = project.staticDirectories[index++];
      if (!root) return next();
      const previous = req.url;
      req.url = route;
      express.static(path.join(siteDir, root), { index: false })(req, res, () => {
        req.url = previous;
        serve();
      });
    }
    serve();
  });
  app.use((req, res, next) => {
    const base = project.baseUrl.replace(/\/$/, '');
    if (base && req.path === base) return res.redirect(302, base + '/');
    if (base && !req.path.startsWith(base + '/')) return next();
    let requested;
    try {
      requested = decodeURIComponent(base ? req.path.slice(base.length) : req.path);
    } catch {
      return res.status(400).end();
    }
    let file = path.resolve(currentOutput, '.' + requested);
    if (file !== currentOutput && !file.startsWith(currentOutput + path.sep))
      return res.status(403).end();
    if (!path.extname(file)) {
      if (fs.existsSync(file + '.html')) file += '.html';
      else file = path.join(file, 'index.html');
    }
    if (path.extname(file) === '.html' && fs.existsSync(file)) {
      return res
        .type('html')
        .send(
          fs
            .readFileSync(file, 'utf8')
            .replace('</body>', '<script src="/__site_editor/assets/loader.js"></script></body>'),
        );
    }
    const previous = req.url;
    req.url = requested;
    express.static(currentOutput)(req, res, () => {
      req.url = previous;
      next();
    });
  });
  server = app.listen(port, '127.0.0.1');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
