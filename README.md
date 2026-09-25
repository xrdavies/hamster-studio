<p align="center">
  <img src="src/renderer/assets/hamster-logo-256.png" width="128" alt="Hamster Studio logo" />
</p>

# Hamster Studio

English · [简体中文](README.zh-CN.md)

Hamster Studio is an open-source desktop app for AI chat and image generation. Connect your own OpenAI Compatible providers using a base URL and API key—no Hamster Studio account required. Switch providers and models within conversations, keep your history locally, and export generated images. The interface supports English and Simplified Chinese, with title search, pinned conversations, and archives for organizing your sessions.

[![Build macOS](https://github.com/xrdavies/hamster-studio/actions/workflows/build-mac.yml/badge.svg)](https://github.com/xrdavies/hamster-studio/actions/workflows/build-mac.yml)
[![Formatting](https://github.com/xrdavies/hamster-studio/actions/workflows/format.yml/badge.svg)](https://github.com/xrdavies/hamster-studio/actions/workflows/format.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Downloads & release notes](https://github.com/xrdavies/hamster-studio/releases) · [Quick start](#quick-start) · [Report an issue](https://github.com/xrdavies/hamster-studio/issues)

## Download and install

Visit [GitHub Releases](https://github.com/xrdavies/hamster-studio/releases) for available packages and release notes. To try changes that have not been released, follow [Development](#development).

The current packaging target is **macOS DMG**; local builds have been verified on **Apple Silicon (arm64)**. Windows, Linux, and Intel Mac packages are not currently provided. Download a matching DMG, open it, and drag Hamster Studio into Applications.

Local builds without an Apple Developer certificate are unsigned. Release signing and notarization depend on the repository's Apple credentials; consult the release notes for the status of each published package. See [BUILD.md](BUILD.md) for local packaging details.

## Quick start

1. Open **Settings → Providers → Add**.
2. Enter a name, your provider's **Base URL**, and your **API key**. A typical base URL is `https://api.example.com/v1`.
3. Click **Fetch provider models**. Fetching happens only when you request it. You can also add model IDs manually and remove models from the list, then save the provider.
4. Create a conversation and choose a provider and model in the input area. The icon indicates whether it is a chat or image generation model.
5. Send a message or describe an image. Use **Export image** below a generated image to save a copy.

Use **Enter** to send and **Shift + Enter** for a new line. Change the interface language under **Settings → General → Language**; your choice is saved locally.

## Image creation and webpage reading

- **Create through conversation:** use a chat model with tool-calling support and select an image model in the composer’s image settings. Inspecting images also requires a vision-capable chat model.
- **Add references:** select or drag in up to 6 PNG, JPEG or WebP images, each up to 10 MB. Ask to combine references or process assets separately.
- **Edit a region:** open the brush action on a reference attachment, paint the area to change, then describe your edit. The image provider must support mask editing; preservation outside the region depends on the model.
- **Preview and export:** click a result to view it at full size, export it, or use it as a reference for another edit. Originals are preserved.
- **Read a webpage:** provide a public URL and ask for a summary. HTML and plain text are supported; login pages, JavaScript rendering and PDFs are not.

Interrupted replies can offer a continuation action. Image requests with uncertain results require confirmation before another paid attempt.

### Provider compatibility

Providers need the endpoints required by your workflow: `/models` for model discovery, streaming `/chat/completions` for chat, `/images/generations` for generation, and `/images/edits` for reference images and region edits. Support for tool calling, vision, multiple references and masks varies by provider and model. Model availability and usage charges are determined by your provider.

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
| `npm test`               | Run frontend tests                             |
| `npm run test:rust`      | Run backend tests                              |
| `npm run build:renderer` | Build the React frontend                       |
| `npm run build:dir`      | Compile the native executable without bundling |
| `npm run build`          | Build the Tauri application and macOS DMG      |

Build output is written to `src-tauri/target/release/bundle/`. Translation dictionaries live in `src/shared/locales/`. The Agent system prompt lives in `src-tauri/prompts/image-agent.txt` and is embedded at compile time.

### Release

From a clean `main` checkout:

```bash
npm run release -- patch
```

Use `minor`, `major` or an explicit version instead of `patch` when needed. The command prepares version changes, commits, tags and pushes. GitHub Actions then builds, signs and publishes the release; signing credentials must be configured first.

### Documentation

| Document                                    | Contents                                                 |
| ------------------------------------------- | -------------------------------------------------------- |
| [Build guide](BUILD.md)                     | Local builds, developer tools and implementation details |
| [Release guide](RELEASE.md)                 | Release preparation, signing and updater packages        |
| [Model capabilities](MODEL_CAPABILITIES.md) | Classification rules and catalog updates                 |
| [Changelog](CHANGELOG.md)                   | Development changes, maintained in Chinese               |

## Contributing

Bug reports and feature requests are welcome in [GitHub Issues](https://github.com/xrdavies/hamster-studio/issues). Include your app version, operating system, reproduction steps, and expected behavior. Remove API keys and private content from logs before sharing them.

For pull requests, keep changes focused, use [Conventional Commits](https://www.conventionalcommits.org/), and run formatting checks, type checks, tests, and the renderer build before submitting.

## Author and acknowledgments

Created by **Frozen** · [X / @xrdavies](https://x.com/xrdavies).

Thanks to Tauri, React, Vite, Lucide, rusqlite, react-markdown, and the other open-source projects used by Hamster Studio. Dependencies retain their respective licenses.

## License

[MIT](LICENSE) · Copyright © 2026 Frozen.
