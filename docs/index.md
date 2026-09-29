---
layout: home

hero:
  name: MeiliOps
  text: The desktop admin app for Meilisearch
  tagline: Browse documents, tune settings, watch tasks and run local instances. Native, fast and light on memory. No Electron.
  image:
    src: /logo.svg
    alt: MeiliOps
  actions:
    - theme: brand
      text: Download
      link: https://github.com/SrilalS/MeiliOps/releases/latest
    - theme: alt
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/SrilalS/MeiliOps

features:
  - icon: 🧭
    title: The whole API, not a subset
    details: Every stable Meilisearch operation has a screen (140 of 143 in v1.54; the other 3 are Enterprise-only and reachable from the API console).
  - icon: ⚡
    title: Native and lightweight
    details: Built on Tauri 2 and SolidJS. A 3 MB installer and about 140 MB of RAM at idle, most of which is the system WebView.
  - icon: 📄
    title: Documents at scale
    details: A virtualized grid that scrolls tens of thousands of documents smoothly, with filter, sort, a JSON editor and CSV / NDJSON / JSON import.
  - icon: 🧬
    title: Schema insight
    details: Field types, fill rates, value ranges and top values from a sample, exact facet counts from the whole index, and one-click "make filterable".
  - icon: 🖥️
    title: Local instances
    details: Download the official binary (SHA-256 verified), run several instances side by side with their own ports, keys and launch flags.
  - icon: 🔐
    title: Keys stay in your keychain
    details: API keys go to Windows Credential Manager, macOS Keychain or the Secret Service. Never to a plain-text config file.
---

<div class="vp-doc" style="max-width: 1152px; margin: 48px auto 0; padding: 0 24px;">

![MeiliOps showing the documents grid with a JSON editor](/screenshots/documents.png)

</div>
