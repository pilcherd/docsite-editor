const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { EditorError, hash, safePath, walk, atomicWrite } = require('./paths.cjs');
const { describe, split, listPages, pageInfo, mediaReference } = require('./content.cjs');
const { resolveProject, loadProject, within } = require('./project.cjs');
const { parseNavigation, validateNavigation, replaceNavigation } = require('./navigation.cjs');
const { mainRange } = require('./homepage.cjs');
const API = '/__site_editor';
const imagePattern = /\.(?:png|jpe?g|gif|webp|svg|avif)$/i;
function createApi(options) {
  const siteDir = path.resolve(options.siteDir),
    secret = crypto.randomBytes(32).toString('hex');
  let project = options.project,
    initialization,
    queue = Promise.resolve();
  async function getProject() {
    if (options.getProject) project = await options.getProject();
    if (!project) {
      initialization ??= (async () => {
        const fallback = resolveProject(siteDir, {}, options);
        return fallback.configFile ? loadProject(siteDir, options) : fallback;
      })();
      project = await initialization;
    }
    return project;
  }
  const transact = (fn) => {
    const task = queue.then(fn, fn);
    queue = task.catch(() => {});
    return task;
  };
  const router = express.Router(),
    local = (value) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);
  router.use((req, res, next) => {
    if (!req.path.startsWith(API)) return next('router');
    let host;
    try {
      host = new URL('http://' + req.headers.host).hostname;
    } catch {}
    if (!local(req.socket.remoteAddress) || !['localhost', '127.0.0.1', '[::1]'].includes(host))
      return res.status(403).json({ error: 'The site editor is available only on this computer.' });
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      (req.headers.origin !== 'http://' + req.headers.host ||
        req.headers['x-site-editor-token'] !== secret)
    )
      return res.status(403).json({ error: 'Reload the local editor before saving.' });
    next();
  });
  router.use(API, express.json({ limit: '24mb' }));
  const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const allowedDoc = (p, file) =>
    file.collections.some(
      (c) =>
        within(p, c.root) &&
        (/\.(?:md|mdx|markdown)$/.test(p) || (c.type === 'pages' && /\.[jt]sx?$/.test(p))),
    );
  const allowedMedia = (p, file) =>
    imagePattern.test(p) &&
    (file.staticDirectories.some((root) => within(p, root)) ||
      file.mediaRoots.some((root) => within(p, root.path)));
  async function snapshot(relative, content) {
    const folder = path.join(
      siteDir,
      '.docsite-editor/history',
      new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomUUID(),
    );
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, path.basename(relative)), content);
    await fs.writeFile(
      path.join(folder, 'record.json'),
      JSON.stringify({ path: relative, date: new Date().toISOString() }),
    );
  }
  async function readDoc(relative, collectionId) {
    const project = await getProject(),
      file = await safePath(siteDir, relative, (p) => allowedDoc(p, project));
    const source = await fs.readFile(file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') throw new EditorError(404, 'Page not found.');
      throw error;
    });
    const collection = project.collections
      .filter((c) => within(relative, c.root) && (!collectionId || c.id === collectionId))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (!collection) throw new EditorError(400, 'Select a configured content collection.');
    const info = pageInfo(project, collection, relative, source);
    let editable = source,
      range,
      kind = info.kind,
      message;
    if (kind === 'jsx') {
      try {
        range = mainRange(source, project.jsxRoot);
        editable = source.slice(range.start, range.end);
      } catch (error) {
        kind = 'code';
        message = error.message;
      }
    }
    let document = null;
    if (kind !== 'code')
      try {
        document = await describe(editable);
      } catch (error) {
        message = error.message;
      }
    return {
      ...info,
      source: editable,
      revision: hash(source),
      kind,
      document,
      metadata: kind === 'mdx' ? split(source).metadata : { title: info.title },
      jsxImageHelper: /\buseBaseUrl\b/.test(source),
      capabilities: { visual: !!document, message },
      previewPreamble: range ? source.slice(0, range.start) : '',
    };
  }
  function navDescriptor(project, selector) {
    const selected =
      project.navigation.find((n) => n.id === selector || n.collection === selector) ||
      (!selector ? project.navigation[0] : null);
    if (!selected)
      throw new EditorError(
        400,
        'This content collection has no sidebar. Pages can still be edited and created.',
      );
    return selected;
  }
  async function readNavigation(project, selector) {
    const nav = navDescriptor(project, selector);
    if (!nav.path)
      return {
        descriptor: nav,
        mode: 'automatic',
        value: { defaultSidebar: [{ type: 'autogenerated', dirName: '.' }] },
        revision: null,
        source: null,
      };
    const file = await safePath(siteDir, nav.path, (p) => p === nav.path);
    const source = await fs.readFile(file, 'utf8');
    try {
      return {
        descriptor: nav,
        mode: 'tree',
        value: parseNavigation(source, nav.path).value,
        revision: hash(source),
        source,
      };
    } catch (error) {
      return {
        descriptor: nav,
        mode: 'source',
        value: null,
        revision: hash(source),
        source,
        message: error.message,
      };
    }
  }
  const idsFor = async (project, nav) =>
    new Set(
      (await listPages(siteDir, project))
        .filter(
          (p) =>
            p.collection === nav.collection ||
            project.collections.find((c) => c.id === p.collection)?.sidebarPath === nav.path,
        )
        .map((p) => p.id)
        .filter(Boolean),
    );
  router.get(API + '/status', (req, res) => res.json(options.getStatus?.() || { building: false }));
  router.get(
    API + '/session',
    handle(async (req, res) => {
      const project = await getProject();
      res.json({
        token: secret,
        siteName: project.siteName,
        baseUrl: project.baseUrl,
        mode: options.mode || 'development',
        collections: project.collections,
        navigation: project.navigation,
        mediaRoots: project.mediaRoots,
        styles: project.styles,
        preview: project.preview,
        warnings: project.warnings,
      });
    }),
  );
  router.get(
    API + '/git/status',
    handle(async (req, res) => res.json(await require('./git.cjs').gitStatus(siteDir))),
  );
  router.get(
    API + '/git/diff',
    handle(async (req, res) =>
      res.json({ diff: await require('./git.cjs').gitDiff(siteDir, req.query.path) }),
    ),
  );
  router.post(
    API + '/git/commit',
    handle(async (req, res) =>
      res.json(await transact(() => require('./git.cjs').commitFiles(siteDir, req.body))),
    ),
  );
  router.post(
    API + '/git/revert',
    handle(async (req, res) =>
      res.json(
        await transact(async () => {
          const result = await require('./git.cjs').revertFiles(siteDir, req.body);
          options.onSave?.();
          return result;
        }),
      ),
    ),
  );
  router.post(
    API + '/git/pull',
    handle(async (req, res) =>
      res.json(
        await transact(async () => {
          const result = await require('./git.cjs').pullChanges(siteDir, req.body);
          if (result.updated) options.onSave?.();
          return result;
        }),
      ),
    ),
  );
  router.get(
    API + '/project',
    handle(async (req, res) => res.json(await getProject())),
  );
  router.get(
    API + '/pages',
    handle(async (req, res) => res.json(await listPages(siteDir, await getProject()))),
  );
  router.get(
    API + '/document',
    handle(async (req, res) => res.json(await readDoc(req.query.path, req.query.collection))),
  );
  router.post(
    API + '/parse',
    handle(async (req, res) => res.json(await describe(req.body.source || ''))),
  );
  router.get(
    API + '/navigation',
    handle(async (req, res) => {
      const project = await getProject();
      if (!project.navigation.length) return res.json({ mode: 'none', value: {}, revision: null });
      res.json(await readNavigation(project, req.query.navigation || req.query.collection));
    }),
  );
  router.put(
    API + '/navigation',
    handle(async (req, res) =>
      res.json(
        await transact(async () => {
          const project = await getProject(),
            nav = navDescriptor(project, req.body.navigation || req.body.collection);
          if (!nav.path)
            throw new EditorError(
              400,
              'This sidebar is generated from folders. Use Add section or page front matter to change it.',
            );
          const file = await safePath(siteDir, nav.path, (p) => p === nav.path),
            old = await fs.readFile(file, 'utf8');
          if (hash(old) !== req.body.revision)
            throw new EditorError(409, 'The sidebar changed on disk. Reload it before saving.');
          let next;
          if (typeof req.body.source === 'string') {
            next = req.body.source;
            if (nav.path.endsWith('.json')) JSON.parse(next);
            else
              require('@babel/parser').parse(next, {
                sourceType: 'unambiguous',
                plugins: ['typescript'],
              });
          } else {
            validateNavigation(req.body.value, await idsFor(project, nav));
            next = replaceNavigation(old, req.body.value, nav.path);
          }
          await snapshot(nav.path, old);
          await atomicWrite(file, next);
          options.onSave?.();
          return { ...(await readNavigation(project, nav.id)), saved: true };
        }),
      ),
    ),
  );
  router.post(
    API + '/sections',
    handle(async (req, res) =>
      res.status(201).json(
        await transact(async () => {
          const project = await getProject(),
            collection = project.collections.find(
              (c) => c.id === req.body.collection && c.type === 'docs',
            );
          if (!collection || !req.body.title?.trim())
            throw new EditorError(400, 'Choose a docs collection and enter a section title.');
          const directory = path.posix.join(collection.root, req.body.folder || '');
          const relative = directory + '/_category_.json';
          const file = await safePath(
            siteDir,
            relative,
            (p) => within(p, collection.root) && p.endsWith('/_category_.json'),
          );
          let old;
          try {
            old = await fs.readFile(file, 'utf8');
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          const value = old ? JSON.parse(old) : {};
          if (old && req.body.revision !== hash(old))
            throw new EditorError(409, 'The section changed on disk. Reload it before saving.');
          value.label = req.body.title.trim();
          if (req.body.position !== undefined) {
            if (!Number.isFinite(Number(req.body.position)))
              throw new EditorError(400, 'Enter a numeric position.');
            value.position = Number(req.body.position);
          }
          value.link ??= { type: 'generated-index' };
          if (old) await snapshot(relative, old);
          await atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
          options.onSave?.();
          return { path: relative, value, revision: hash(JSON.stringify(value, null, 2) + '\n') };
        }),
      ),
    ),
  );
  router.get(
    API + '/sections',
    handle(async (req, res) => {
      const project = await getProject(),
        collection = project.collections.find((c) => c.id === req.query.collection);
      if (!collection) return res.json([]);
      const names = await walk(
        path.join(siteDir, collection.root),
        (name) => path.posix.basename(name) === '_category_.json',
      );
      res.json(
        await Promise.all(
          names.map(async (name) => {
            const relative = path.posix.join(collection.root, name),
              source = await fs.readFile(path.join(siteDir, relative), 'utf8');
            return {
              path: relative,
              folder: path.posix.dirname(name),
              value: JSON.parse(source),
              revision: hash(source),
            };
          }),
        ),
      );
    }),
  );
  router.put(
    API + '/document',
    handle(async (req, res) =>
      res.json(
        await transact(async () => {
          const project = await getProject(),
            relative = req.body.path,
            file = await safePath(siteDir, relative, (p) => allowedDoc(p, project));
          const record = await readDoc(relative, req.body.collection),
            old = await fs.readFile(file, 'utf8');
          if (hash(old) !== req.body.revision)
            throw new EditorError(
              409,
              'This file changed on disk. Reload it or copy your draft before saving.',
            );
          if (typeof req.body.source !== 'string' || req.body.source.length > 4_000_000)
            throw new EditorError(400, 'The page is too large.');
          let next = req.body.source;
          if (record.kind === 'jsx') {
            const range = mainRange(old, project.jsxRoot);
            next = old.slice(0, range.start) + next + old.slice(range.end);
            require('@babel/parser').parse(next, {
              sourceType: 'unambiguous',
              plugins: ['typescript', 'jsx'],
            });
          } else if (record.kind === 'code')
            require('@babel/parser').parse(next, {
              sourceType: 'unambiguous',
              plugins: ['typescript', 'jsx'],
            });
          else await describe(next); // Unknown MDX constructs are preserved; the host compiler validates custom plugins during rebuild.
          const changes = [];
          const collection = project.collections.find((c) => c.id === record.collection);
          if (collection.type === 'docs') {
            const candidate = pageInfo({ ...project, pages: [] }, collection, relative, next),
              pages = await listPages(siteDir, project);
            if (
              pages.some(
                (p) =>
                  p.path !== relative &&
                  p.collection === collection.id &&
                  (p.id === candidate.id || p.url === candidate.url),
              )
            )
              throw new EditorError(409, 'Another page uses this documentation ID or address.');
            if (record.id !== candidate.id)
              for (const nav of project.navigation.filter(
                (n) =>
                  n.path && (n.collection === collection.id || n.path === collection.sidebarPath),
              )) {
                const navFile = await safePath(siteDir, nav.path, (p) => p === nav.path),
                  navSource = await fs.readFile(navFile, 'utf8'),
                  navigation = parseNavigation(navSource, nav.path).value;
                const rename = (value) =>
                  Array.isArray(value)
                    ? value.map(rename)
                    : value && typeof value === 'object'
                      ? Object.fromEntries(
                          Object.entries(value).map(([key, item]) => [
                            key,
                            ['id', 'docId'].includes(key) && item === record.id
                              ? candidate.id
                              : rename(item),
                          ]),
                        )
                      : value === record.id
                        ? candidate.id
                        : value;
                changes.push({
                  relative: nav.path,
                  file: navFile,
                  old: navSource,
                  next: replaceNavigation(navSource, rename(navigation), nav.path),
                });
              }
          }
          const all = [{ relative, file, old, next }, ...changes];
          for (const change of all) await snapshot(change.relative, change.old);
          const completed = [];
          try {
            for (const change of all) {
              await atomicWrite(change.file, change.next);
              completed.push(change);
            }
          } catch (error) {
            for (const change of completed.reverse()) await atomicWrite(change.file, change.old);
            throw error;
          }
          project.pages = project.pages.filter(
            (p) => p.path !== relative || p.collection !== collection.id,
          );
          options.onSave?.();
          return await readDoc(relative, collection.id);
        }),
      ),
    ),
  );
  router.post(
    API + '/pages',
    handle(async (req, res) =>
      res.status(201).json(
        await transact(async () => {
          const project = await getProject();
          const collection =
            project.collections.find((c) => c.id === req.body.collection) ||
            project.collections.find((c) => within(req.body.path, c.root));
          if (!collection) throw new EditorError(400, 'Choose a content collection.');
          const relative = req.body.path,
            file = await safePath(
              siteDir,
              relative,
              (p) => within(p, collection.root) && /\.(?:md|mdx)$/.test(p),
            );
          const title = req.body.title?.trim();
          if (!title || title.length > 250 || /[\r\n]/.test(title))
            throw new EditorError(400, 'Enter a page title on one line, up to 250 characters.');
          try {
            await fs.access(file);
            throw new EditorError(409, 'A file already exists at this path.');
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          const metadata = { ...project.newPageDefaults, title };
          if (collection.type === 'blog') metadata.date = new Date().toISOString();
          const yaml = require('js-yaml');
          const source =
            '---\n' +
            yaml.dump(metadata) +
            '---\n\n' +
            (metadata.hide_title ? '# ' + title + '\n\n' : '') +
            'Start writing here.\n';
          await describe(source);
          let navChange;
          if (collection.type === 'docs' && req.body.sidebar) {
            const nav = await readNavigation(project, req.body.navigation || collection.id);
            if (nav.mode === 'source')
              throw new EditorError(
                400,
                'This sidebar uses custom code. Create the page without an explicit sidebar item, then edit its source.',
              );
            if (nav.mode === 'tree') {
              if (nav.revision !== req.body.navigationRevision)
                throw new EditorError(
                  409,
                  'The sidebar changed on disk. Reload it before adding a page.',
                );
              const value = nav.value;
              let items = value[req.body.sidebar];
              if (!items) throw new EditorError(400, 'Choose an existing sidebar.');
              for (const index of req.body.parent || []) {
                if (items[index]?.type !== 'category')
                  throw new EditorError(400, 'Choose an existing section.');
                items = items[index].items;
              }
              if (!items.some((item) => item?.type === 'autogenerated')) {
                const info = pageInfo(project, collection, relative, source);
                items.push(info.id);
                const ids = await idsFor(project, nav.descriptor);
                ids.add(info.id);
                validateNavigation(value, ids);
                const navFile = await safePath(
                  siteDir,
                  nav.descriptor.path,
                  (p) => p === nav.descriptor.path,
                );
                navChange = {
                  file: navFile,
                  relative: nav.descriptor.path,
                  old: nav.source,
                  next: replaceNavigation(nav.source, value, nav.descriptor.path),
                };
              }
            }
          }
          await atomicWrite(file, source);
          try {
            if (navChange) {
              await snapshot(navChange.relative, navChange.old);
              await atomicWrite(navChange.file, navChange.next);
            }
          } catch (error) {
            await fs.unlink(file);
            throw error;
          }
          options.onSave?.();
          return await readDoc(relative, collection.id);
        }),
      ),
    ),
  );
  router.get(
    API + '/media',
    handle(async (req, res) => {
      const project = await getProject(),
        files = new Map(),
        query = String(req.query.search || '').toLowerCase(),
        libraryRoots = require('./media.cjs').staticMediaRoots(project);
      for (const root of libraryRoots) {
        const names = await walk(path.join(siteDir, root.path), (name) => imagePattern.test(name));
        for (const name of names) {
          const relative = path.posix.join(root.path, name);
          if (!relative.toLowerCase().includes(query)) continue;
          const url = '/' + path.posix.relative(root.path, relative);
          files.set(relative, {
            path: relative,
            url,
            name: path.posix.basename(name),
            folder: path.posix.dirname(relative),
            root: root.id,
          });
        }
      }
      res.json({
        total: files.size,
        roots: libraryRoots,
        folders: await require('./media.cjs').mediaFolders(siteDir, libraryRoots),
        files: [...files.values()],
      });
    }),
  );
  router.get(
    API + '/media/file',
    handle(async (req, res) => {
      const project = await getProject();
      res.sendFile(await safePath(siteDir, req.query.path, (p) => allowedMedia(p, project)));
    }),
  );
  router.post(
    API + '/media',
    handle(async (req, res) =>
      res.status(201).json(
        await transact(async () => {
          const project = await getProject(),
            { folder, name, data } = req.body;
          if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
            throw new EditorError(400, 'Invalid image data.');
          const buffer = Buffer.from(data, 'base64');
          if (buffer.length > 12 * 1024 * 1024 || buffer.length < 4)
            throw new EditorError(400, 'Choose an image smaller than 12 MB.');
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name || ''))
            throw new EditorError(
              400,
              'Use a filename containing letters, numbers, dots, underscores and hyphens.',
            );
          const relative = path.posix.join(String(folder || ''), name),
            file = await safePath(
              siteDir,
              relative,
              (p) =>
                allowedMedia(p, project) &&
                project.staticDirectories.some((root) => within(p, root)),
            ),
            ext = path.extname(name).toLowerCase();
          const valid =
            ext === '.png'
              ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : ['.jpg', '.jpeg'].includes(ext)
                ? buffer[0] === 255 && buffer[1] === 216
                : ext === '.gif'
                  ? buffer.toString('ascii', 0, 3) === 'GIF'
                  : ext === '.webp'
                    ? buffer.toString('ascii', 0, 4) === 'RIFF' &&
                      buffer.toString('ascii', 8, 12) === 'WEBP'
                    : ext === '.avif'
                      ? buffer.toString('ascii', 4, 8) === 'ftyp' &&
                        /avif|avis/.test(buffer.toString('ascii', 8, 32))
                      : ext === '.svg'
                        ? /<svg[\s/>]/i.test(buffer.toString()) &&
                          !/<script|on\w+\s*=|<foreignObject|javascript:/i.test(buffer.toString())
                        : false;
          if (!valid)
            throw new EditorError(400, 'The file does not match a supported image format.');
          await fs.mkdir(path.dirname(file), { recursive: true });
          try {
            await fs.writeFile(file, buffer, { flag: 'wx' });
          } catch (error) {
            if (error.code === 'EEXIST')
              throw new EditorError(409, 'An image already uses that filename.');
            throw error;
          }
          return { path: relative, url: mediaReference(project, relative, req.body.document) };
        }),
      ),
    ),
  );
  router.post(
    API + '/component',
    handle(async (req, res) =>
      res.json({ fields: require('./components.cjs').componentFields(req.body.source || '') }),
    ),
  );
  router.post(
    API + '/component/update',
    handle(async (req, res) =>
      res.json({
        source: require('./components.cjs').updateComponent(
          req.body.source || '',
          req.body.key,
          req.body.value,
        ),
      }),
    ),
  );
  router.post(
    API + '/preview',
    handle(async (req, res) =>
      res.json(await require('./preview.cjs').buildPreview(siteDir, await getProject(), req.body)),
    ),
  );
  router.get(
    API + '/settings',
    handle(async (req, res) =>
      res.json(
        await require('./settings.cjs').readSettings(
          siteDir,
          await getProject(),
          req.query.stylesheet,
        ),
      ),
    ),
  );
  router.put(
    API + '/settings',
    handle(async (req, res) =>
      res.json(
        await transact(async () => {
          const project = await getProject(),
            { readSettings, updateSettings, validateConfigSource } = require('./settings.cjs');
          const current = await readSettings(siteDir, project, req.body.stylesheet);
          if (
            current.revision !== req.body.revision ||
            current.cssRevision !== req.body.cssRevision
          )
            throw new EditorError(409, 'Site settings changed on disk. Reload them before saving.');
          const changes = [];
          if (current.configPath) {
            const file = await safePath(
                siteDir,
                current.configPath,
                (p) => p === current.configPath,
              ),
              old = current.configSource;
            const next =
              typeof req.body.configSource === 'string'
                ? req.body.configSource
                : updateSettings(old, req.body.values || {});
            validateConfigSource(next);
            if (next !== old) changes.push({ relative: current.configPath, file, old, next });
          }
          if (current.cssPath) {
            if (typeof req.body.css !== 'string' || req.body.css.length > 1_000_000)
              throw new EditorError(400, 'The stylesheet is too large.');
            if (current.cssPath.endsWith('.css')) require('postcss').parse(req.body.css);
            const file = await safePath(siteDir, current.cssPath, (p) =>
              project.stylesheets.includes(p),
            );
            if (req.body.css !== current.css)
              changes.push({
                relative: current.cssPath,
                file,
                old: current.css,
                next: req.body.css,
              });
          }
          for (const c of changes) await snapshot(c.relative, c.old);
          const completed = [];
          try {
            for (const c of changes) {
              await atomicWrite(c.file, c.next);
              completed.push(c);
            }
          } catch (error) {
            for (const c of completed.reverse()) await atomicWrite(c.file, c.old);
            throw error;
          }
          options.onSave?.();
          return await readSettings(siteDir, project, req.body.stylesheet);
        }),
      ),
    ),
  );
  router.get(
    API + '/styles',
    handle(async (req, res) => {
      const project = await getProject();
      res
        .type('css')
        .send(
          (
            await Promise.all(
              project.stylesheets.map((file) =>
                fs.readFile(path.join(siteDir, file), 'utf8').catch(() => ''),
              ),
            )
          ).join('\n'),
        );
    }),
  );
  router.use(
    API + '/assets',
    express.static(path.join(__dirname, '../client/dist'), { fallthrough: false }),
  );
  router.use((error, req, res, next) => {
    if (!req.path.startsWith(API)) return next(error);
    res.status(error.status || 400).json({ error: error.message || 'The editor request failed.' });
  });
  return router;
}
module.exports = { createApi };
