module.exports = {
  title: 'Maple Notes',
  tagline: 'A fictional documentation site',
  url: 'https://example.test',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  presets: [
    [
      require.resolve('@docusaurus/preset-classic'),
      {
        docs: { routeBasePath: '/', sidebarPath: require.resolve('./sidebars.cjs') },
        blog: false,
        pages: false,
        theme: { customCss: require.resolve('./theme.css') },
      },
    ],
  ],
  plugins:
    process.env.DOCUSAURUS_SITE_EDITOR === '1'
      ? [
          [
            require.resolve('../..'),
            {
              styles: [
                { label: 'Callout', className: 'example-callout' },
                { label: 'Caption', className: 'example-caption' },
              ],
              newPageDefaults: { hide_title: true },
            },
          ],
        ]
      : [],
  themeConfig: {
    navbar: { title: 'Maple Notes', items: [{ label: 'Field guide', to: '/', position: 'left' }] },
    colorMode: { defaultMode: 'light', disableSwitch: true },
    footer: { copyright: 'Fictional example content for Docsite Editor by pilcherd.' },
  },
};
