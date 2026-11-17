const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  { promisify } = require('node:util'),
  exec = promisify(require('node:child_process').execFile);
const { gitStatus, commitFiles, gitDiff, revertFiles, pullChanges } = require('../lib/git.cjs');
async function fixture(t, initial = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-editor-git-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = async (...args) => (await exec('git', ['-C', root, ...args])).stdout.trim();
  const write = async (name, source) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), source);
  };
  await git('init', '-q');
  await git('config', 'user.name', 'Editor test');
  await git('config', 'user.email', 'editor@example.test');
  if (initial) {
    await write('docs/page.md', '# Original\n');
    await write('README.md', 'Original\n');
    await git('add', '.');
    await git('commit', '-qm', 'Initial');
  }
  return { root, git, write };
}
test('commit selected files and preserve unrelated staged changes', async (t) => {
  const { root, git, write } = await fixture(t);
  await write('docs/page.md', '# Updated\n');
  await write('docs/new image.svg', '<svg/>');
  await write('README.md', 'Unrelated\n');
  await git('add', 'README.md');
  const status = await gitStatus(root);
  assert.equal(status.files.length, 3);
  assert.match(await gitDiff(root, 'docs/page.md'), /\+# Updated/);
  const result = await commitFiles(root, {
    revision: status.revision,
    paths: ['docs/page.md', 'docs/new image.svg'],
    message: 'Improve documentation\n\nInclude the new illustration.',
  });
  assert.equal(result.files.length, 2);
  assert.match(result.commit, /^[a-f0-9]{40}$/);
  assert.deepEqual((await git('show', '--format=', '--name-only', 'HEAD')).split('\n').sort(), [
    'docs/new image.svg',
    'docs/page.md',
  ]);
  assert.equal(await git('diff', '--cached', '--name-only'), 'README.md');
  assert.match(await git('log', '-1', '--format=%B'), /Include the new illustration/);
});
test('stale changes, unknown files and empty messages are rejected before staging', async (t) => {
  const { root, git, write } = await fixture(t);
  await write('docs/page.md', 'First edit\n');
  const status = await gitStatus(root);
  await write('docs/page.md', 'Changed after review\n');
  await assert.rejects(
    () =>
      commitFiles(root, { revision: status.revision, paths: ['docs/page.md'], message: 'Stale' }),
    /Refresh and review/,
  );
  const fresh = await gitStatus(root);
  await assert.rejects(
    () =>
      commitFiles(root, { revision: fresh.revision, paths: ['../outside'], message: 'Bad path' }),
    /current changes list/,
  );
  await assert.rejects(
    () => commitFiles(root, { revision: fresh.revision, paths: ['docs/page.md'], message: ' ' }),
    /commit message/,
  );
  assert.equal(await git('diff', '--cached', '--name-only'), '');
});
test('initial commits, tracked deletions and staged renames work', async (t) => {
  const { root, git, write } = await fixture(t, false);
  await write('first.md', '# First\n');
  let status = await gitStatus(root);
  await commitFiles(root, {
    revision: status.revision,
    paths: ['first.md'],
    message: 'First documentation',
  });
  await git('mv', 'first.md', 'renamed.md');
  status = await gitStatus(root);
  assert.equal(status.files[0].originalPath, 'first.md');
  await commitFiles(root, {
    revision: status.revision,
    paths: ['renamed.md'],
    message: 'Rename page',
  });
  assert.equal(await git('ls-files'), 'renamed.md');
  await fs.unlink(path.join(root, 'renamed.md'));
  status = await gitStatus(root);
  await commitFiles(root, {
    revision: status.revision,
    paths: ['renamed.md'],
    message: 'Remove page',
  });
  assert.equal(await git('ls-files'), '');
});
test('nested documentation checkouts do not expose or commit parent-project files', async (t) => {
  const { root, git, write } = await fixture(t);
  await write('website/docs/start.md', '# Start\n');
  await git('add', '.');
  await git('commit', '-qm', 'Add website');
  await write('README.md', 'Outside site\n');
  await git('add', 'README.md');
  await write('website/docs/start.md', '# New\n');
  const site = path.join(root, 'website'),
    status = await gitStatus(site);
  assert.deepEqual(
    status.files.map((f) => f.path),
    ['docs/start.md'],
  );
  await commitFiles(site, {
    revision: status.revision,
    paths: ['docs/start.md'],
    message: 'Update site',
  });
  assert.equal(await git('diff', '--cached', '--name-only'), 'README.md');
});

test('revert only selected files and preserve their working and staged versions in recovery copies', async (t) => {
  const { root, git, write } = await fixture(t);
  await write('docs/page.md', '# Staged edit\n');
  await git('add', 'docs/page.md');
  await write('docs/page.md', '# Working edit\n');
  await write('docs/new.md', 'New documentation\n');
  await write('README.md', 'Keep this staged\n');
  await git('add', 'README.md');
  const before = await gitStatus(root),
    head = await git('rev-parse', 'HEAD');
  const result = await revertFiles(root, {
    revision: before.revision,
    paths: ['docs/page.md', 'docs/new.md'],
    confirmed: true,
  });
  assert.equal(await fs.readFile(path.join(root, 'docs/page.md'), 'utf8'), '# Original\n');
  await assert.rejects(() => fs.access(path.join(root, 'docs/new.md')));
  assert.equal(await git('diff', '--cached', '--name-only'), 'README.md');
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'Keep this staged\n');
  assert.equal(await git('rev-parse', 'HEAD'), head);
  const recovery = JSON.parse(
    await fs.readFile(path.join(root, result.backup, 'record.json'), 'utf8'),
  );
  const working = recovery.files.find((file) => file.path === 'docs/page.md'),
    staged = recovery.index.find((file) => file.path === 'docs/page.md');
  assert.equal(
    await fs.readFile(path.join(root, result.backup, working.copy), 'utf8'),
    '# Working edit\n',
  );
  assert.equal(
    await fs.readFile(path.join(root, result.backup, staged.copy), 'utf8'),
    '# Staged edit\n',
  );
  assert(result.removed.includes('docs/new.md'));
  assert(result.restored.includes('docs/page.md'));
});
test('revert requires confirmation and rejects stale working or index changes', async (t) => {
  const { root, git, write } = await fixture(t);
  await write('docs/page.md', 'Change\n');
  const before = await gitStatus(root);
  await assert.rejects(
    () => revertFiles(root, { revision: before.revision, paths: ['docs/page.md'] }),
    /Confirm/,
  );
  await write('docs/page.md', 'Newer change\n');
  await assert.rejects(
    () =>
      revertFiles(root, { revision: before.revision, paths: ['docs/page.md'], confirmed: true }),
    /Refresh and review/,
  );
  await git('add', 'docs/page.md');
  const review = await gitStatus(root);
  await git('reset', '-q', 'HEAD', '--', 'docs/page.md');
  await assert.rejects(
    () =>
      revertFiles(root, { revision: review.revision, paths: ['docs/page.md'], confirmed: true }),
    /Refresh and review/,
  );
  const latest = await gitStatus(root);
  await assert.rejects(
    () => revertFiles(root, { revision: latest.revision, paths: ['../outside'], confirmed: true }),
    /current changes list/,
  );
  assert.equal(await fs.readFile(path.join(root, 'docs/page.md'), 'utf8'), 'Newer change\n');
});
test('revert restores deleted files and staged renames, and removes staged new files', async (t) => {
  const { root, git, write } = await fixture(t);
  await git('mv', 'docs/page.md', 'docs/renamed.md');
  await git('rm', 'README.md');
  await write('docs/added.md', 'Added\n');
  await git('add', 'docs/added.md');
  const before = await gitStatus(root);
  await revertFiles(root, {
    revision: before.revision,
    paths: before.files.map((f) => f.path),
    confirmed: true,
  });
  assert.equal(await fs.readFile(path.join(root, 'docs/page.md'), 'utf8'), '# Original\n');
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'Original\n');
  await assert.rejects(() => fs.access(path.join(root, 'docs/renamed.md')));
  await assert.rejects(() => fs.access(path.join(root, 'docs/added.md')));
  assert.equal(await git('diff', '--cached', '--name-only'), '');
});
test('revert works before the first commit and stays inside nested checkouts', async (t) => {
  const initial = await fixture(t, false);
  await initial.write('first.md', 'First\n');
  await initial.git('add', 'first.md');
  let status = await gitStatus(initial.root);
  await revertFiles(initial.root, {
    revision: status.revision,
    paths: ['first.md'],
    confirmed: true,
  });
  assert.equal(await initial.git('ls-files'), '');
  await assert.rejects(() => fs.access(path.join(initial.root, 'first.md')));
  const { root, git, write } = await fixture(t);
  await write('site/docs/start.md', 'Original site\n');
  await git('add', 'site');
  await git('commit', '-qm', 'Site');
  await write('site/docs/start.md', 'Changed site\n');
  await write('README.md', 'Outside site\n');
  await git('add', 'README.md');
  const site = path.join(root, 'site');
  status = await gitStatus(site);
  await revertFiles(site, { revision: status.revision, paths: ['docs/start.md'], confirmed: true });
  assert.equal(await fs.readFile(path.join(site, 'docs/start.md'), 'utf8'), 'Original site\n');
  assert.equal(await git('diff', '--cached', '--name-only'), 'README.md');
});
test('a failed revert rolls back selected working files and staging', async (t) => {
  const { root, git, write } = await fixture(t);
  await write('docs/page.md', 'Staged page\n');
  await git('add', 'docs/page.md');
  await write('docs/page.md', 'Working page\n');
  await write('docs/doomed.md', 'New file\n');
  await git('add', 'docs/doomed.md');
  await write('README.md', 'Unrelated\n');
  await git('add', 'README.md');
  const staged = await git('diff', '--cached', '--binary'),
    before = await gitStatus(root),
    originalUnlink = fs.unlink;
  let failed = false;
  fs.unlink = async (file) => {
    if (!failed && file === path.join(root, 'docs/doomed.md')) {
      failed = true;
      throw Object.assign(new Error('Injected file removal failure'), { code: 'EACCES' });
    }
    return originalUnlink(file);
  };
  try {
    await assert.rejects(
      () =>
        revertFiles(root, {
          revision: before.revision,
          paths: ['docs/page.md', 'docs/doomed.md'],
          confirmed: true,
        }),
      /previous files and staging were restored/,
    );
  } finally {
    fs.unlink = originalUnlink;
  }
  assert.equal(await fs.readFile(path.join(root, 'docs/page.md'), 'utf8'), 'Working page\n');
  assert.equal(await fs.readFile(path.join(root, 'docs/doomed.md'), 'utf8'), 'New file\n');
  assert.equal(await git('diff', '--cached', '--binary'), staged);
});

async function remoteFixture(t) {
  const f = await fixture(t),
    remote = path.join(f.root, '.git', 'fixture-origin.git'),
    other = await fs.mkdtemp(path.join(os.tmpdir(), 'site-editor-remote-'));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  await f.git('init', '--bare', '-q', remote);
  await f.git('remote', 'add', 'origin', remote);
  const branch = await f.git('branch', '--show-current');
  await f.git('push', '-qu', 'origin', branch);
  await exec('git', ['clone', '-q', remote, other]);
  const git = async (...args) => (await exec('git', ['-C', other, ...args])).stdout.trim();
  await git('config', 'user.name', 'Remote fixture');
  await git('config', 'user.email', 'remote@example.test');
  return {
    ...f,
    other,
    remote,
    remoteGit: git,
    async upstream(text) {
      await fs.writeFile(path.join(other, 'docs/page.md'), text);
      await git('add', '.');
      await git('commit', '-qm', 'Remote documentation');
      await git('push', '-q');
    },
  };
}
test('pull fast-forwards a clean checkout without running merge hooks or pushing', async (t) => {
  const f = await remoteFixture(t);
  await f.upstream('# Upstream page\n');
  const hooks = path.join(f.root, '.git', 'custom-hooks');
  await fs.mkdir(hooks);
  const marker = path.join(f.root, '.git', 'hook-ran');
  await fs.writeFile(
    path.join(hooks, 'post-merge'),
    '#!/bin/sh\ntouch ' + JSON.stringify(marker) + '\n',
    { mode: 0o755 },
  );
  await f.git('config', 'core.hooksPath', hooks);
  const before = await gitStatus(f.root);
  assert(before.pull.available);
  assert(before.pull.upstream.startsWith('origin/'));
  const result = await pullChanges(f.root, { revision: before.revision, confirmed: true });
  assert(result.updated);
  assert.equal(await fs.readFile(path.join(f.root, 'docs/page.md'), 'utf8'), '# Upstream page\n');
  assert.equal(
    await fs.stat(marker).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal(await f.git('rev-parse', 'HEAD'), await f.remoteGit('rev-parse', 'HEAD'));
  const second = await pullChanges(f.root, { revision: result.status.revision, confirmed: true });
  assert.equal(second.updated, false);
});
test('pull requires confirmation and a current review but allows unrelated saved changes', async (t) => {
  const f = await remoteFixture(t),
    before = await gitStatus(f.root);
  await assert.rejects(() => pullChanges(f.root, { revision: before.revision }), /Confirm/);
  await f.write('README.md', 'Staged local work\n');
  await f.git('add', 'README.md');
  await f.write('README.md', 'Working local work\n');
  await f.write('local-notes.md', 'Untracked local work\n');
  await assert.rejects(
    () => pullChanges(f.root, { revision: before.revision, confirmed: true }),
    /checkout changed/,
  );
  await f.upstream('# Incoming documentation\n');
  const nested = path.join(f.root, 'docs'),
    fresh = await gitStatus(nested);
  assert.equal(fresh.files.length, 0);
  assert(fresh.pull.available);
  assert(fresh.pull.localChanges);
  const staged = await f.git('diff', '--cached', '--binary');
  const result = await pullChanges(nested, { revision: fresh.revision, confirmed: true });
  assert(result.updated);
  assert.equal(
    await fs.readFile(path.join(f.root, 'docs/page.md'), 'utf8'),
    '# Incoming documentation\n',
  );
  assert.equal(await fs.readFile(path.join(f.root, 'README.md'), 'utf8'), 'Working local work\n');
  assert.equal(
    await fs.readFile(path.join(f.root, 'local-notes.md'), 'utf8'),
    'Untracked local work\n',
  );
  assert.equal(await f.git('diff', '--cached', '--binary'), staged);
  assert.equal(await f.git('stash', 'list'), '');
  const again = await pullChanges(nested, { revision: result.status.revision, confirmed: true });
  assert.equal(again.updated, false);
});
test('overlapping saved changes are preserved and no autostash is used even when configured', async (t) => {
  const f = await remoteFixture(t);
  await f.upstream('# Incoming documentation\n');
  await f.write('docs/page.md', '# Staged local documentation\n');
  await f.git('add', 'docs/page.md');
  await f.write('docs/page.md', '# Working local documentation\n');
  await f.git('config', 'merge.autostash', 'true');
  const before = await gitStatus(f.root),
    head = await f.git('rev-parse', 'HEAD'),
    staged = await f.git('diff', '--cached', '--binary');
  assert(before.pull.available);
  await assert.rejects(
    () => pullChanges(f.root, { revision: before.revision, confirmed: true }),
    /will not overwrite local changes.*outside this editor/,
  );
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(
    await fs.readFile(path.join(f.root, 'docs/page.md'), 'utf8'),
    '# Working local documentation\n',
  );
  assert.equal(await f.git('diff', '--cached', '--binary'), staged);
  assert.equal(await f.git('stash', 'list'), '');
  assert.equal(await f.git('ls-files', '-u'), '');
});
test('untracked files that collide with incoming files are not overwritten', async (t) => {
  const f = await remoteFixture(t);
  await fs.writeFile(path.join(f.other, 'new.md'), 'Incoming file\n');
  await f.remoteGit('add', '.');
  await f.remoteGit('commit', '-qm', 'New upstream page');
  await f.remoteGit('push', '-q');
  await f.write('new.md', 'Keep my untracked file\n');
  const before = await gitStatus(f.root),
    head = await f.git('rev-parse', 'HEAD');
  assert(before.pull.available);
  await assert.rejects(
    () => pullChanges(f.root, { revision: before.revision, confirmed: true }),
    /will not overwrite/,
  );
  assert.equal(await fs.readFile(path.join(f.root, 'new.md'), 'utf8'), 'Keep my untracked file\n');
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
});
test('divergent pulls leave local commits and files intact and require outside-UI resolution', async (t) => {
  const f = await remoteFixture(t);
  await f.write('docs/page.md', '# Local commit\n');
  await f.git('add', '.');
  await f.git('commit', '-qm', 'Local');
  const head = await f.git('rev-parse', 'HEAD');
  await f.upstream('# Conflicting remote commit\n');
  const before = await gitStatus(f.root);
  await assert.rejects(
    () => pullChanges(f.root, { revision: before.revision, confirmed: true }),
    /outside this editor/,
  );
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(await f.git('ls-files', '-u'), '');
  assert.equal(await fs.readFile(path.join(f.root, 'docs/page.md'), 'utf8'), '# Local commit\n');
});
test('missing upstreams, detached heads and existing conflicts cannot be pulled in the editor', async (t) => {
  const f = await fixture(t);
  assert.match((await gitStatus(f.root)).pull.reason, /tracking upstream/);
  await f.git('checkout', '--detach', '-q');
  assert.match((await gitStatus(f.root)).pull.reason, /Check out a branch/);
  await f.git('checkout', '-qb', 'local');
  await f.write('docs/page.md', '# Local\n');
  await f.git('commit', '-am', 'Local');
  await f.git('checkout', '-qb', 'other', 'HEAD~1');
  await f.write('docs/page.md', '# Other\n');
  await f.git('commit', '-am', 'Other');
  await f.git('merge', 'local').catch(() => {});
  const before = await gitStatus(f.root);
  assert.match(before.pull.reason, /conflicts.*outside/);
  await assert.rejects(
    () => pullChanges(f.root, { revision: before.revision, confirmed: true }),
    /conflicts/,
  );
});
