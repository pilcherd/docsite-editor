const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

const forbidden = [
  /[A-Z]:[\\/](?:Users|Projects)[\\/]/i,
  /\/(?:home|Users)\/[^/\s"']+\//,
  /(?:AccountKey|SharedAccessKey|InstrumentationKey)\s*=/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const privateTerms = JSON.parse(process.env.RELEASE_FORBIDDEN_TERMS || '[]');
assert(
  Array.isArray(privateTerms) &&
    privateTerms.every((term) => typeof term === 'string' && term.length),
  'RELEASE_FORBIDDEN_TERMS must be a JSON array of nonempty strings.',
);

async function checkText(name, data) {
  for (const term of privateTerms)
    assert(!data.toLowerCase().includes(term.toLowerCase()), 'Private term found in ' + name);
  for (const pattern of forbidden)
    assert(!pattern.test(data), 'Private project reference or credential pattern in ' + name);
}

async function checkRelease() {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'MIT');
  const license = await fs.readFile(path.join(root, 'LICENSE'), 'utf8');
  assert(license.includes('Permission is hereby granted, free of charge'));
  assert(!license.includes('No public license'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = JSON.parse(
    execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
    }),
  )[0];
  const required = [
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.txt',
    'TRADEMARKS.md',
    'index.cjs',
    'bin/editor.cjs',
    'client/dist/editor.js',
    'client/dist/editor.css',
    'client/dist/loader.js',
    'client/dist/preview.js',
  ];
  const files = result.files.map((file) => file.path);
  for (const name of required) assert(files.includes(name), 'Missing package file: ' + name);
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  for (const match of readme.matchAll(/!\[[^\]]*\]\((docs\/screenshots\/[a-z0-9-]+\.jpg)\)/g))
    assert(files.includes(match[1]), 'README screenshot is missing from the package: ' + match[1]);
  const tracked = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  for (const name of new Set([...tracked, ...files])) {
    await checkText(name, name);
    assert(
      !/(?:^|\/)(?:\.git|\.env(?:\..*)?|\.docsite-editor|node_modules|coverage|release)(?:\/|$)/.test(
        name,
      ),
      'Private/generated file: ' + name,
    );
    if (files.includes(name))
      assert(
        /^(?:index\.cjs|bin\/|lib\/|client\/|package\.json|README\.md|LICENSE|CHANGELOG\.md|TRADEMARKS\.md|THIRD_PARTY_NOTICES\.txt)$/.test(
          name,
        ) ||
          /^(?:bin|lib|client)\//.test(name) ||
          /^docs\/screenshots\/[a-z0-9-]+\.jpg$/.test(name),
        'Unexpected package file: ' + name,
      );
    if (/^docs\/screenshots\/[a-z0-9-]+\.jpg$/.test(name)) {
      const image = await fs.readFile(path.join(root, name));
      assert(image.length <= 5_000_000, 'Screenshot is too large: ' + name);
      assert(
        image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff,
        'Screenshot must be JPEG: ' + name,
      );
    } else {
      const data = await fs.readFile(path.join(root, name), 'utf8');
      await checkText(name, data);
    }
  }
  console.log(
    'Release checks passed: MIT, generic source, required bundles, notices and package allowlist (' +
      files.length +
      ' files).',
  );
}
module.exports = { checkRelease };
if (require.main === module)
  checkRelease().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
