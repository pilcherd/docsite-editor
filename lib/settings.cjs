const fs = require('node:fs/promises');
const path = require('node:path');
const parser = require('@babel/parser');
const { EditorError, hash } = require('./paths.cjs');
const { exportedObject, unwrap } = require('./literals.cjs');
function configFields(source) {
  const root = exportedObject(source),
    result = [];
  function walk(node, parts) {
    node = unwrap(node);
    if (!node) return;
    if (['StringLiteral', 'BooleanLiteral', 'NumericLiteral'].includes(node.type))
      result.push({
        key: parts.join('.'),
        path: parts,
        value: node.value,
        start: node.start,
        end: node.end,
        type: typeof node.value,
      });
    else if (node.type === 'ObjectExpression')
      for (const property of node.properties)
        if (property.type === 'ObjectProperty' && !property.computed)
          walk(property.value, [...parts, property.key.name || property.key.value]);
        else if (node.type === 'ArrayExpression')
          node.elements.forEach((item, index) => item && walk(item, [...parts, index]));
  }
  walk(root, []);
  return result.filter((field) => !['plugins', 'presets'].includes(String(field.path[0])));
}
async function readSettings(siteDir, project, stylesheet) {
  project = project || require('./project.cjs').resolveProject(siteDir);
  const configPath = project.configFile;
  const source = configPath ? await fs.readFile(path.join(siteDir, configPath), 'utf8') : '';
  let fields = [],
    configMessage = null;
  try {
    if (source) fields = configFields(source);
  } catch (error) {
    configMessage = error.message;
  }
  const cssPath =
    stylesheet && project.stylesheets.includes(stylesheet)
      ? stylesheet
      : project.stylesheets[0] || null;
  const css = cssPath
    ? await fs
        .readFile(path.join(siteDir, cssPath), 'utf8')
        .catch((error) => (error.code === 'ENOENT' ? '' : Promise.reject(error)))
    : '';
  return {
    configPath,
    configSource: source,
    fields: fields.map(({ start, end, ...field }) => field),
    revision: hash(source),
    cssPath,
    stylesheets: project.stylesheets,
    css,
    cssRevision: hash(css),
    configMessage,
  };
}
function updateSettings(source, values) {
  const fields = configFields(source),
    edits = [];
  for (const [key, value] of Object.entries(values)) {
    const field = fields.find((f) => f.key === key);
    if (!field || typeof value !== field.type)
      throw new EditorError(400, 'Invalid setting: ' + key);
    if (value !== field.value) edits.push({ ...field, text: JSON.stringify(value) });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  configFields(source);
  return source;
}
function validateConfigSource(source) {
  parser.parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
}
module.exports = { configFields, readSettings, updateSettings, validateConfigSource };
