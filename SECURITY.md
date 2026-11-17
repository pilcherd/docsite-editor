# Security and trust boundary

This is a local authoring tool for trusted source checkouts, not a hosted CMS.
The CLI binds to loopback. The API checks the remote address and Host header,
and requires a matching Origin and a session token for writes. Do not expose it
through a reverse proxy, public tunnel or network listener.

Opening a site loads its Docusaurus configuration and builds its React/MDX
components. Those files and build plugins execute code with your local user
permissions. The preview iframe is sandboxed, but it does not make an untrusted
repository safe to run. Git commits use the checkout's identity and may execute
its configured Git hooks.

Saving writes to the checkout. Uploading an image writes immediately. Revert can
remove new files and discard selected edits, with recovery copies retained in
`.docsite-editor/history`. Keep independent backups for important work.
Neither editing nor committing pushes, deploys or sends email.

Only start the editor on your own computer. Normal site builds must leave
`DOCUSAURUS_SITE_EDITOR` unset. Do not put secrets into documentation or uploaded files.

## Reporting a vulnerability

Do not publish credentials, private source or exploit details in a public issue.
Use GitHub's [Report a vulnerability](https://github.com/pilcherd/docsite-editor/security/advisories/new)
feature to contact the maintainer privately. Include the affected version,
reproduction steps and expected behavior, using fictional data and no secrets.
