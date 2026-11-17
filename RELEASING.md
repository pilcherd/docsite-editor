# Preparing a release

The public source repository is [pilcherd/docsite-editor](https://github.com/pilcherd/docsite-editor).
GitHub releases contain the built npm tarball. Publishing to npm is a separate,
explicit release-owner action; GitHub publication does not publish to npm.

## Validate

```bash
npm ci
npm run check
npm run test:site
npm audit --omit=dev
npm pack --dry-run
npm pack
```

Review dependency advisories before publication. Docusaurus and React are peer
dependencies supplied by the consuming site, so consumers must also check their
host dependency tree. Review the MIT copyright owner, third-party notices and [trademark notice](TRADEMARKS.md). Use independent product branding and descriptive compatibility wording; a notice alone does not grant permission for prohibited trademark uses.

The package contains runtime code, browser bundles, source and licenses.
Tests, private site data, local history, environment files and Git internals must
not be present. `check:release` checks the package allowlist, tracked and untracked source, filenames, and private-path and credential
patterns. Set `RELEASE_FORBIDDEN_TERMS` to a JSON array of private project names
or domains when checking a fork; those terms are supplied locally and are not
embedded in the generic source. It cannot prove the absence of every possible secret; review the diff.

## Publish a clean source snapshot

The public repository starts with reviewed generic source. Keep site data,
credentials, local recovery copies and unrelated development history out of
commits and release archives.

Commit the reviewed source changes, then run:

```bash
npm run release:snapshot
```

This exports tracked files from the current commit to `release/` as a ZIP, without
the old `.git` directory, generated bundles, dependencies, tarballs or untracked
site files. It refuses tracked changes or a release check failure. The ZIP also
has a SHA-256 checksum. Unpack it, review it, and create a new Git repository in
that extracted folder. A source checkout can build its bundles with `npm ci` and
`npm run build`.

No release script pushes to Git, publishes to npm, creates a hosted repository,
or deploys a website. Those steps remain with the release owner.

## Dependency review

On 2026-11-16, `npm audit --omit=dev --package-lock-only` reported zero
advisories for the plugin's runtime dependency tree. A separate query of npm's
bulk advisory service against the complete lockfile reported advisories for
development-only `serialize-javascript`, `tinypool` and `uuid` packages, including
high and critical advisories. These come through the Docusaurus 3.10.2 test
fixture and are not included in the plugin tarball.

No forced dependency downgrade or transitive major-version override was applied.
The test toolchain and the consuming site's dependencies need their own review;
a clean plugin runtime audit is not a clean bill of health for the host site.
Re-run runtime and full dependency checks before subsequent releases.
