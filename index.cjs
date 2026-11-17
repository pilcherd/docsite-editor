const path = require('node:path');
const { createApi } = require('./lib/server.cjs');
const { resolveProject, captureContent } = require('./lib/project.cjs');
const { writeManifest } = require('./lib/manifest.cjs');
module.exports = function siteEditor(context, options = {}) {
  if (process.env.DOCUSAURUS_SITE_EDITOR !== '1' || options.enabled === false)
    return { name: 'docsite-editor' };
  const project = resolveProject(
    context.siteDir,
    context.siteConfig,
    options,
    context.siteConfigPath,
  );
  const api = createApi({ siteDir: context.siteDir, getProject: () => project, ...options });
  return {
    name: 'docsite-editor',
    allContentLoaded({ allContent }) {
      captureContent(project, allContent);
      writeManifest(project);
    },
    getClientModules() {
      return [path.join(__dirname, 'client/loader.js')];
    },
    configureWebpack(config, isServer) {
      const aliases = Object.fromEntries(
        Object.entries(config.resolve?.alias || {}).filter(
          ([, value]) => typeof value === 'string',
        ),
      );
      project.aliases = { ...project.aliases, ...aliases };
      writeManifest(project);
      if (isServer) return {};
      const previous = config.devServer?.setupMiddlewares;
      return {
        devServer: {
          setupMiddlewares(middlewares, server) {
            const existing = previous ? previous(middlewares, server) : middlewares;
            // Mutate the shared list: webpack-merge composes setup functions and concatenates returned arrays.
            // Returning a new prepended array lets the original history fallback run before our API.
            if (!existing.some((item) => item.name === 'docsite-editor'))
              existing.unshift({ name: 'docsite-editor', middleware: api });
            return existing;
          },
        },
      };
    },
  };
};
