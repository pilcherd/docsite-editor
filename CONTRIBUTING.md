# Contributing

Use Node.js 22 or newer and npm. Work in a trusted local checkout.

## Development

```bash
npm ci
npm run format
npm run check
npm run test:site
```

The integration test creates a temporary, synthetic Docusaurus site with custom
content and media paths, multiple documentation instances, and a base URL prefix.
It checks development mode, built mode and an editor-free release build. No
customer checkout or credentials are required. On Windows, WSL is recommended for
the integration test; it uses directory symlinks and local child processes.

To check an additional site's content without writing to it:

```bash
TEST_DOCS_SITE=/path/to/site npm run test:corpus
```

That site must already have its dependencies installed. The compiler executes
local configuration and imports, so use only trusted repositories.

## Source structure

- `index.cjs`: Docusaurus plugin registration and development middleware.
- `bin/editor.cjs`: local CLI and built-site rebuild lifecycle.
- `lib/`: project discovery, parsing, local APIs, file boundaries and Git operations.
- `client/`: React editor, dialogs, source preservation and preview selection.
- `scripts/`: build, dependency notices, integration tests and release checks.
- `test/`: isolated unit and API fixtures.

Run `npm run format` before committing. Add regression tests for source
preservation, filesystem mutations and parser fixes. Test alternate content
folders and base URLs instead of assuming the classic preset's defaults. Keep
unsupported MDX as source rather than silently discarding syntax.

## Pull requests

Describe the behavior change, compatibility impact and checks run. Do not include
site content, screenshots from private projects, credentials, generated previews,
local backups or build logs. Third-party dependencies retain their own licenses.
