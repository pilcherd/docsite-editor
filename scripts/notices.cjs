const fs = require('node:fs/promises');
const path = require('node:path');

async function packageFor(root, input) {
  let directory = path.dirname(path.resolve(root, input));
  const modules = path.join(root, 'node_modules') + path.sep;
  if (!directory.startsWith(modules)) return null;
  while (directory.startsWith(modules)) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name && manifest.version) return { directory, manifest };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    directory = path.dirname(directory);
  }
  return null;
}

async function writeNotices(root, inputs) {
  const packages = new Map();
  for (const input of Object.keys(inputs)) {
    const pkg = await packageFor(root, input);
    if (pkg) packages.set(pkg.manifest.name + '@' + pkg.manifest.version, pkg);
  }
  const sections = [
    'Third-party notices',
    'Generated from packages included in the browser bundles. Runtime npm dependencies retain their own license files.',
  ];
  for (const [name, { directory, manifest }] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const license =
      typeof manifest.license === 'string' ? manifest.license : JSON.stringify(manifest.license);
    const names = (await fs.readdir(directory))
      .filter((name) => /^(?:licen[sc]e|copying|notice)(?:[.-]|$)/i.test(name))
      .sort();
    if (!license || !names.length)
      throw new Error('Review missing license information for ' + name);
    const texts = [];
    for (const file of names) {
      const filename = path.join(directory, file);
      if ((await fs.stat(filename)).isFile())
        texts.push(file + '\n\n' + (await fs.readFile(filename, 'utf8')).trim());
    }
    if (!texts.length) throw new Error('No license text found for ' + name);
    sections.push(
      '='.repeat(72) + '\n' + name + '\nLicense: ' + license + '\n\n' + texts.join('\n\n'),
    );
  }
  await fs.writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), sections.join('\n\n') + '\n');
  return packages.size;
}
module.exports = { writeNotices };
