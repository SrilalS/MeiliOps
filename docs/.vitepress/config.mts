import { defineConfig } from "vitepress";

const repo = "https://github.com/SrilalS/MeiliOps";

export default defineConfig({
  title: "MeiliOps",
  description: "A fast, native desktop admin app for Meilisearch.",
  // Served from GitHub Pages at https://srilals.github.io/MeiliOps/
  base: "/MeiliOps/",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/MeiliOps/logo.svg" }],
    ["meta", { name: "theme-color", content: "#ff5cb2" }],
  ],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "Reference", link: "/reference/api-coverage", activeMatch: "/reference/" },
      { text: "Development", link: "/development/", activeMatch: "/development/" },
      { text: "Download", link: `${repo}/releases/latest` },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Start here",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Connections", link: "/guide/connections" },
            { text: "Local instances", link: "/guide/local-instances" },
          ],
        },
        {
          text: "Working with indexes",
          items: [
            { text: "Documents", link: "/guide/documents" },
            { text: "Search playground", link: "/guide/search" },
            { text: "Schema", link: "/guide/schema" },
            { text: "Index settings", link: "/guide/settings" },
          ],
        },
        {
          text: "Server administration",
          items: [
            { text: "Tasks and batches", link: "/guide/tasks" },
            { text: "API keys", link: "/guide/keys" },
            { text: "Operations", link: "/guide/operations" },
            { text: "Search features", link: "/guide/search-features" },
          ],
        },
        {
          text: "Help",
          items: [
            { text: "Appearance", link: "/guide/appearance" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "API coverage", link: "/reference/api-coverage" },
            { text: "Security", link: "/reference/security" },
            { text: "Performance", link: "/reference/performance" },
          ],
        },
      ],
      "/development/": [
        {
          text: "Development",
          items: [
            { text: "Contributing", link: "/development/" },
            { text: "Architecture", link: "/development/architecture" },
            { text: "Releasing", link: "/development/releasing" },
            { text: "New Meilisearch versions", link: "/development/meilisearch-updates" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: "Edit this page on GitHub" },
    search: { provider: "local" },
    footer: {
      message: "Released under the MIT License. Not affiliated with Meilisearch.",
      copyright: "© MeiliOps contributors",
    },
  },
});
