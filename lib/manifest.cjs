const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function writeManifest(project) {
  const folder = path.join(project.siteDir, '.docsite-editor');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'project.json');
  try {
    const prior = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (prior.fingerprint === project.fingerprint) {
      const pages = new Map(prior.pages.map((page) => [page.collection + ':' + page.path, page]));
      project.pages.forEach((page) => pages.set(page.collection + ':' + page.path, page));
      project.pages = [...pages.values()];
    }
  } catch {}
  const temporary = file + '.' + crypto.randomUUID();
  fs.writeFileSync(temporary, JSON.stringify(project));
  fs.renameSync(temporary, file);
}
function readManifest(fallback) {
  const file = path.join(fallback.siteDir, '.docsite-editor/project.json');
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.siteDir === fallback.siteDir && value.schema === 2) return value;
  } catch {}
  return fallback;
}
module.exports = { writeManifest, readManifest };
