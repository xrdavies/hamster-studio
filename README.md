<p align="center">
  <img src="src/renderer/assets/hamster-logo-256.png" width="256" alt="Hamster Studio logo" />
</p>

# Hamster Studio

English · [简体中文](README.zh-CN.md)

Hamster Studio is an open-source desktop app for AI chat and image generation. Connect your own OpenAI Compatible providers using a base URL and API key—no Hamster Studio account required. Switch providers and models within conversations, keep your history locally, and export generated images. The interface supports English and Simplified Chinese, with title search, pinned conversations, and archives for organizing your sessions.

[![Build macOS](https://github.com/xrdavies/hamster-studio/actions/workflows/build-mac.yml/badge.svg)](https://github.com/xrdavies/hamster-studio/actions/workflows/build-mac.yml)
[![Formatting](https://github.com/xrdavies/hamster-studio/actions/workflows/format.yml/badge.svg)](https://github.com/xrdavies/hamster-studio/actions/workflows/format.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Downloads & release notes](https://github.com/xrdavies/hamster-studio/releases) · [Quick start](#quick-start) · [Report an issue](https://github.com/xrdavies/hamster-studio/issues)

## Download and install

No public release is available yet. You can run the project from source or build a local app using the instructions below.

The current packaging target is **macOS DMG**; local builds have been verified on **Apple Silicon (arm64)**. Windows, Linux, and Intel Mac packages are not currently provided. Once releases are available, download the DMG for your architecture, open it, and drag Hamster Studio into Applications.

Local builds without an Apple Developer certificate are unsigned. Release signing and notarization depend on the repository's Apple credentials; consult the release notes for the status of each published package. See [BUILD.md](BUILD.md) for packaging details.

## Quick start

1. Open **Settings → Providers → Add**.
2. Enter a name, your provider's **Base URL**, and your **API key**. A typical base URL is `https://api.example.com/v1`.
3. Click **Fetch provider models**. Fetching happens only when you request it. You can also add model IDs manually and remove models from the list, then save the provider.
4. Create a conversation and choose a provider and model in the input area. The icon indicates whether it is a chat or image generation model.
5. Send a message or describe an image. Use **Export image** below a generated image to save a copy.

Use **Enter** to send and **Shift + Enter** for a new line. Change the interface language under **Settings → General → Language**; your choice is saved locally.

Providers must support the OpenAI Compatible endpoints used by the app: `/models`, streaming `/chat/completions`, and `/images/generations` for image generation. Model availability and usage charges are determined by your provider. For image generation, select a supported model such as `gpt-image-2` if your provider offers it.

## Images and webpages

Use a tool-capable chat model to create and edit images conversationally; inspecting images also requires vision support. Select an image model in the composer settings. Attach or drag in PNG, JPEG or WebP files up to 10 MB. Click an image to preview it or use its export action.

Provide a public webpage link and ask for a summary. HTML and plain text are supported; login pages, JavaScript rendering and PDFs are not. Interrupted replies can offer a continuation action; uncertain image requests require confirmation before another paid attempt.

## Data and privacy

- Conversations and provider configuration are stored in `studio.db` within Tauri's application data directory; generated images are stored in its `images/` subdirectory.
- AI requests go directly from the desktop app to your configured provider. Hamster Studio does not require an account or a hosted application backend.
- API keys are stored in the system credential store (macOS Keychain); errors never fall back to plaintext.
- Image inputs and extracted webpage text are sent to your configured conversation provider. Webpage reading contacts the target site; proxy Fake-IP resolution may query Cloudflare DNS over HTTPS with the hostname.
- Update checks contact GitHub. Opening project or author links launches your system browser.

Deleting a provider preserves existing conversations. Select another provider and model to continue them.

## Development

Use **Node.js 24**, npm, Rust stable, and Xcode Command Line Tools on macOS. The app is built with Tauri, React, TypeScript, and Vite.

```bash
git clone https://github.com/xrdavies/hamster-studio.git
cd hamster-studio
npm ci
npm run dev
```

| Command                  | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `npm run dev`            | Start the desktop app in development mode      |
| `npm run format`         | Format source and documentation with Prettier  |
| `npm run format:check`   | Check formatting                               |
| `npm run typecheck`      | Check TypeScript types                         |
| `npm test`               | Run tests                                      |
| `npm run build:renderer` | Build the React frontend                       |
| `npm run build:dir`      | Compile the native executable without bundling |
| `npm run build`          | Build the Tauri application and macOS DMG      |

Build output is written to `src-tauri/target/release/bundle/`. See [BUILD.md](BUILD.md) for signing, publishing, and asset generation. Translation dictionaries live in `src/shared/locales/`; model capability rules and their update workflow are described in [MODEL_CAPABILITIES.md](MODEL_CAPABILITIES.md).

For maintainers: see the [release guide (Chinese)](RELEASE.md) for versioning, tags, signing, and publishing a release.

## Contributing

Bug reports and feature requests are welcome in [GitHub Issues](https://github.com/xrdavies/hamster-studio/issues). Include your app version, operating system, reproduction steps, and expected behavior. Remove API keys and private content from logs before sharing them.

For pull requests, keep changes focused, use [Conventional Commits](https://www.conventionalcommits.org/), and run formatting checks, type checks, tests, and the renderer build before submitting.

## Author and acknowledgments

Created by **Frozen** · [X / @xrdavies](https://x.com/xrdavies).

Thanks to Tauri, React, Vite, Lucide, rusqlite, react-markdown, and the other open-source projects used by Hamster Studio. Dependencies retain their respective licenses.

## License

[MIT](LICENSE) · Copyright © 2026 Frozen.

## Release

From a clean `main` checkout, run `npm run release -- patch` (or `minor`, `major`, an explicit version). This updates versions, commits, tags and pushes; GitHub Actions builds and publishes. See [RELEASE.md](RELEASE.md) for signing setup.

Development changes are maintained in [CHANGELOG.md](CHANGELOG.md) (Chinese). The built-in Agent prompt lives in `src-tauri/prompts/image-agent.txt` and is embedded at compile time.
