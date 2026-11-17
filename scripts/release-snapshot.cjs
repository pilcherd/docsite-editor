const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { checkRelease } = require('./check-release.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (status.trim())
    throw new Error('Commit or remove all source changes before creating a release snapshot.');
  await checkRelease();
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const output = path.join(root, 'release');
  await fs.mkdir(output, { recursive: true });
  const name = 'docsite-editor-' + pkg.version;
  const archive = path.join(output, name + '-source.zip');
  execFileSync(
    'git',
    ['archive', '--format=zip', '--prefix=' + name + '/', '--output=' + archive, 'HEAD'],
    { cwd: root },
  );
  const sum = crypto
    .createHash('sha256')
    .update(await fs.readFile(archive))
    .digest('hex');
  await fs.writeFile(archive + '.sha256', sum + '  ' + path.basename(archive) + '\n');
  console.log('Created source-only snapshot: ' + archive);
  console.log('No remote repository or registry was changed.');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
