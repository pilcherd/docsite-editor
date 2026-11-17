const { execFile } = require('node:child_process'),
  { promisify } = require('node:util'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { EditorError, hash, safePath, atomicWrite } = require('./paths.cjs');
const exec = promisify(execFile),
  crypto = require('node:crypto');
async function git(root, args, timeout = 20000) {
  try {
    return (
      await exec('git', ['-C', root, ...args], {
        env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 4 * 1024 * 1024,
        timeout,
        windowsHide: true,
      })
    ).stdout;
  } catch (error) {
    throw new EditorError(400, (error.stderr || error.message || 'Git command failed.').trim());
  }
}
async function gitStatus(siteDir) {
  let root;
  try {
    root = (await git(siteDir, ['rev-parse', '--show-toplevel'])).trim();
  } catch (error) {
    return {
      available: false,
      message: 'This checkout is not a Git repository, or Git is unavailable. ' + error.message,
      files: [],
    };
  }
  const scope = path.relative(root, siteDir).split(path.sep).join('/') || '.';
  const [raw, branch, head, index] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', scope]),
    git(root, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '(detached HEAD)'),
    git(root, ['rev-parse', '--verify', 'HEAD']).catch(() => ''),
    git(root, ['ls-files', '--stage', '-z', '--', scope]),
  ]);
  const entries = raw.split('\0'),
    files = [];
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    const status = entries[i].slice(0, 2),
      repoPath = entries[i].slice(3),
      originalPath = /[RC]/.test(status) ? entries[++i] : null;
    const relative = path.relative(siteDir, path.join(root, repoPath)).split(path.sep).join('/');
    let file;
    try {
      file = await safePath(siteDir, relative, () => true);
    } catch {
      continue;
    }
    let contents = Buffer.alloc(0),
      reason = null;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile()) reason = 'Only regular files can be committed here.';
      else contents = await fs.readFile(file);
    } catch (error) {
      if (error.code !== 'ENOENT') reason = 'The file cannot be read.';
    }
    const original = originalPath
      ? path.relative(siteDir, path.join(root, originalPath)).split(path.sep).join('/')
      : null;
    if (original)
      try {
        await safePath(siteDir, original, () => true);
      } catch {
        reason = 'This rename crosses the editable checkout boundary.';
      }
    files.push({
      path: relative,
      status,
      originalPath: original,
      disabled: !!reason,
      reason,
      contentHash: hash(contents),
    });
  }

  const [wholeStatus, upstream] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => ''),
  ]);
  const conflicts = wholeStatus
    .split('\0')
    .some((entry) => /^(?:DD|AU|UD|UA|DU|AA|UU) /.test(entry));
  const reason = conflicts
    ? 'This checkout has conflicts. Resolve them outside this editor before pulling.'
    : branch.trim() === '(detached HEAD)'
      ? 'Check out a branch and configure its upstream outside this editor.'
      : !upstream.trim()
        ? 'Configure a tracking upstream for this branch outside this editor.'
        : null;
  const pull = {
    available: !reason,
    upstream: upstream.trim() || null,
    localChanges: !!wholeStatus,
    reason,
  };
  const revision = hash(
    JSON.stringify({ head, raw, index, files, wholeStatus, branch: branch.trim(), pull }),
  );

  return {
    available: true,
    branch: branch.trim(),
    head: head.trim(),
    files: files.map(({ contentHash, ...file }) => file),
    revision,
    pull,
  };
}
async function commitFiles(siteDir, input) {
  const before = await gitStatus(siteDir);
  if (!before.available) throw new EditorError(400, before.message);
  if (input.revision !== before.revision)
    throw new EditorError(
      409,
      'Files changed since this list was loaded. Refresh and review them before committing.',
    );
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message || message.length > 10000 || message.includes('\0'))
    throw new EditorError(400, 'Enter a commit message, up to 10,000 characters.');
  if (!Array.isArray(input.paths) || !input.paths.length)
    throw new EditorError(400, 'Choose at least one changed file.');
  const chosen = [...new Set(input.paths)].map((name) => {
    const file = before.files.find((file) => file.path === name && !file.disabled);
    if (!file) throw new EditorError(400, 'Choose files from the current changes list.');
    return file;
  });
  const root = (await git(siteDir, ['rev-parse', '--show-toplevel'])).trim(),
    repoPath = (name) => path.relative(root, path.join(siteDir, name)).split(path.sep).join('/');
  const paths = [
    ...new Set(
      chosen.flatMap((file) => [
        repoPath(file.path),
        ...(file.originalPath ? [repoPath(file.originalPath)] : []),
      ]),
    ),
  ];
  // Already staged renames have no old index entry, so stage only paths still known to the index or working tree.
  const tracked = new Set((await git(root, ['ls-files', '-z'])).split('\0'));
  const add = [];
  for (const name of paths) {
    if (tracked.has(name)) {
      add.push(name);
      continue;
    }
    try {
      await fs.lstat(path.join(root, name));
      add.push(name);
    } catch {}
  }
  if (add.length) await git(root, ['add', '--all', '--', ...add]);
  // --only includes all saved changes in the chosen files and excludes unrelated staged files.
  await git(root, ['commit', '--only', '--message', message, '--', ...paths], 90000);
  const commit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  return { commit, files: chosen.map((file) => file.path), status: await gitStatus(siteDir) };
}
async function gitDiff(siteDir, name) {
  const status = await gitStatus(siteDir),
    file = status.files.find((file) => file.path === name && !file.disabled);
  if (!file) throw new EditorError(400, 'Choose a file from the current changes list.');
  if (file.status === '??' || !status.head) {
    const bytes = await fs.readFile(await safePath(siteDir, name, () => true));
    if (bytes.includes(0) || /\.(?:png|jpe?g|gif|webp|avif|ico|pdf|zip|tgz)$/i.test(name))
      return 'New binary file; its contents are not shown here.';
    return bytes.toString('utf8').slice(0, 100000);
  }
  return (
    (
      await git(siteDir, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        status.head,
        '--',
        name,
        ...(file.originalPath ? [file.originalPath] : []),
      ])
    ).slice(0, 100000) || 'No saved file differences to show.'
  );
}

async function gitInput(root, args, input) {
  const operation = exec('git', ['-C', root, ...args], {
    env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 4 * 1024 * 1024,
    timeout: 20000,
    windowsHide: true,
  });
  operation.child.stdin.end(input);
  try {
    return (await operation).stdout;
  } catch (error) {
    throw new EditorError(400, (error.stderr || error.message).trim());
  }
}
async function revertFiles(siteDir, input) {
  const before = await gitStatus(siteDir);
  if (!before.available) throw new EditorError(400, before.message);
  if (input.confirmed !== true)
    throw new EditorError(400, 'Confirm the selected-file revert before continuing.');
  if (input.revision !== before.revision)
    throw new EditorError(
      409,
      'Files changed since this list was loaded. Refresh and review them before reverting.',
    );
  if (!Array.isArray(input.paths) || !input.paths.length)
    throw new EditorError(400, 'Choose at least one changed file.');
  const chosen = [...new Set(input.paths)].map((name) => {
    const file = before.files.find((file) => file.path === name && !file.disabled);
    if (!file) throw new EditorError(400, 'Choose files from the current changes list.');
    return file;
  });
  const affected = [
    ...new Set(
      chosen.flatMap((file) => [
        file.path,
        ...(file.originalPath && file.status.includes('R') ? [file.originalPath] : []),
      ]),
    ),
  ];
  const root = (await git(siteDir, ['rev-parse', '--show-toplevel'])).trim(),
    repoPath = (name) => path.relative(root, path.join(siteDir, name)).split(path.sep).join('/');
  const files = await Promise.all(
    affected.map(async (name) => ({
      path: name,
      repoPath: repoPath(name),
      absolute: await safePath(siteDir, name, () => true),
    })),
  );
  const paths = files.map((file) => file.repoPath),
    indexRaw = await git(root, ['ls-files', '--stage', '-z', '--', ...paths]);
  const indexEntries = indexRaw
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/);
      if (!match) throw new EditorError(400, 'Cannot preserve this Git index entry.');
      return { mode: match[1], object: match[2], stage: match[3], path: match[4] };
    });
  const headPaths = before.head
    ? new Set(
        (
          await git(root, ['ls-tree', '-r', '--name-only', '-z', before.head, '--', ...paths])
        ).split('\0'),
      )
    : new Set();
  const tracked = paths.filter((name) => headPaths.has(name)),
    added = paths.filter((name) => !headPaths.has(name));
  const backup =
      '.docsite-editor/history/git-revert-' +
      new Date().toISOString().replaceAll(':', '-') +
      '-' +
      crypto.randomUUID(),
    directory = path.join(siteDir, backup);
  await fs.mkdir(path.join(directory, 'working'), { recursive: true });
  await fs.mkdir(path.join(directory, 'index'), { recursive: true });
  const record = { created: new Date().toISOString(), head: before.head, files: [], index: [] };
  // Preserve working copies and each selected staged blob, including binary files and conflict stages.
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let stat;
    try {
      stat = await fs.lstat(file.absolute);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (stat && !stat.isFile())
      throw new EditorError(400, 'Only regular files can be reverted here.');
    const entry = {
      path: file.path,
      exists: !!stat,
      mode: stat?.mode,
      copy: stat ? 'working/' + i : null,
    };
    record.files.push(entry);
    if (stat) await fs.copyFile(file.absolute, path.join(directory, entry.copy));
  }
  for (let i = 0; i < indexEntries.length; i++) {
    const entry = { ...indexEntries[i], copy: 'index/' + i };
    const { stdout } = await exec('git', ['-C', root, 'cat-file', 'blob', entry.object], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 20000,
      windowsHide: true,
    });
    await fs.writeFile(path.join(directory, entry.copy), stdout);
    record.index.push(entry);
  }
  await fs.writeFile(path.join(directory, 'record.json'), JSON.stringify(record, null, 2) + '\n');
  const fresh = await gitStatus(siteDir);
  // Recovery files may be unignored in a newly configured checkout, so compare the actual affected files/index again.
  if (
    fresh.head !== before.head ||
    fresh.files
      .filter((file) => affected.includes(file.path))
      .map((file) => file.path + '\0' + file.status)
      .join() !==
      before.files
        .filter((file) => affected.includes(file.path))
        .map((file) => file.path + '\0' + file.status)
        .join() ||
    (await git(root, ['ls-files', '--stage', '-z', '--', ...paths])) !== indexRaw
  )
    throw new EditorError(
      409,
      'The selected files changed during backup. Refresh and review them before reverting.',
    );
  for (const entry of record.files) {
    const file = files.find((file) => file.path === entry.path);
    let current;
    try {
      current = await fs.readFile(file.absolute);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (
      entry.exists
        ? !current || hash(current) !== hash(await fs.readFile(path.join(directory, entry.copy)))
        : !!current
    )
      throw new EditorError(
        409,
        'The selected files changed during backup. Refresh before reverting.',
      );
  }
  try {
    if (tracked.length)
      await git(root, [
        'restore',
        '--source=' + before.head,
        '--staged',
        '--worktree',
        '--',
        ...tracked,
      ]);
    if (added.length) await git(root, ['update-index', '--force-remove', '--', ...added]);
    for (const file of files.filter((file) => added.includes(file.repoPath)))
      await fs.unlink(file.absolute).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
  } catch (error) {
    try {
      // Restore only the affected index entries; unrelated staged changes remain intact.
      await git(root, ['update-index', '--force-remove', '--', ...paths]);
      if (indexEntries.length)
        await gitInput(
          root,
          ['update-index', '-z', '--index-info'],
          indexEntries
            .map(
              (entry) =>
                entry.mode + ' ' + entry.object + ' ' + entry.stage + '\t' + entry.path + '\0',
            )
            .join(''),
        );
      for (const entry of record.files) {
        const file = files.find((file) => file.path === entry.path);
        await fs.unlink(file.absolute).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (entry.exists) {
          await atomicWrite(file.absolute, await fs.readFile(path.join(directory, entry.copy)));
          await fs.chmod(file.absolute, entry.mode);
        }
      }
    } catch (rollback) {
      throw new EditorError(
        400,
        'Revert could not finish or fully restore the checkout. Recovery copies are in ' +
          backup +
          '. ' +
          error.message,
      );
    }
    throw new EditorError(
      400,
      'Revert failed; the previous files and staging were restored. Recovery copies are in ' +
        backup +
        '. ' +
        error.message,
    );
  }
  return {
    files: chosen.map((file) => file.path),
    affected,
    restored: files.filter((file) => headPaths.has(file.repoPath)).map((file) => file.path),
    removed: files.filter((file) => !headPaths.has(file.repoPath)).map((file) => file.path),
    backup,
    status: await gitStatus(siteDir),
  };
}

async function pullChanges(siteDir, input) {
  if (input.confirmed !== true)
    throw new EditorError(400, 'Confirm pulling updates before continuing.');
  const before = await gitStatus(siteDir);
  if (!before.available) throw new EditorError(400, before.message);
  if (input.revision !== before.revision)
    throw new EditorError(409, 'The checkout changed. Refresh and review it before pulling.');
  if (!before.pull.available) throw new EditorError(409, before.pull.reason);
  const root = (await git(siteDir, ['rev-parse', '--show-toplevel'])).trim();
  try {
    // A pull may update local files, but must never create merge commits or run local merge hooks.
    await git(
      root,
      [
        '-c',
        'core.hooksPath=' + require('node:os').devNull,
        'pull',
        '--ff-only',
        '--no-rebase',
        '--no-autostash',
        '--no-edit',
      ],
      90000,
    );
  } catch (error) {
    const message = error.message.replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@');
    throw new EditorError(
      409,
      'Pull did not complete. Git will not overwrite local changes. If files overlap, commit or stash those changes outside this editor, then retry. Resolve conflicts or diverged branches outside this editor. ' +
        message,
    );
  }
  const status = await gitStatus(siteDir);
  return {
    updated: status.head !== before.head,
    head: status.head,
    upstream: before.pull.upstream,
    status,
  };
}
module.exports = { gitStatus, commitFiles, gitDiff, revertFiles, pullChanges };
