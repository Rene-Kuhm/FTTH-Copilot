# Tauri Desktop Build — Linux & Windows

FTTH-Copilot is distributed as a native desktop app via [Tauri 2.x](https://tauri.app/), which wraps the Next.js web build in a lightweight native window using the system webview.

## Architecture

```
┌─────────────────────────────────────────────┐
│  apps/web (Next.js + Tauri)                 │
│  ├── app/         Next.js App Router         │
│  ├── components/  Shared UI                  │
│  ├── src-tauri/   Rust desktop shell         │
│  │   ├── Cargo.toml                          │
│  │   ├── tauri.conf.json                     │
│  │   ├── icons/                              │
│  │   └── src/                                │
│  └── public/                                 │
└─────────────────────────────────────────────┘
```

The Tauri config (`src-tauri/tauri.conf.json`) sits inside `apps/web/`. It uses the same `package.json` for npm scripts.

## Brand alignment

The Tauri app uses the same brand colors as the web:

| Token | Hex | Tauri usage |
|---|---|---|
| `--color-bg` | `#1a1218` | Window theme (system) |
| `--color-surface` | `#20161e` | (web layer only) |
| `--color-accent` | `#f23077` | Brand pink in icons |
| `--color-text` | `#f6eff3` | (web layer only) |

The launcher icon (`src-tauri/icons/icon.png` and all derivatives) is generated from `apps/web/public/icons/icon-512.png` using `pnpm tauri icon`.

## Building

### Prerequisites

- Node.js 22
- pnpm 11
- Rust toolchain (1.77+)
- **Linux**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`
- **Windows**: WebView2 (preinstalled on Windows 10+)

### Local build

```bash
# 1. Install dependencies
pnpm install --frozen-lockfile

# 2. Build Next.js
cd apps/web
pnpm build

# 3. Build Tauri
cd apps/web
pnpm tauri:build              # All targets for current OS
pnpm tauri:build:linux        # Linux only (.deb + AppImage)
pnpm tauri:build:windows      # Windows only (NSIS + MSI)
```

Outputs are placed in `apps/web/src-tauri/target/release/bundle/`:

```
apps/web/src-tauri/target/release/bundle/
├── deb/FTTH-Copilot_0.2.1_amd64.deb
├── appimage/FTTH-Copilot_0.2.1_amd64.AppImage
├── msi/FTTH-Copilot_0.2.1_x64_en-US.msi        (Windows)
└── nsis/FTTH-Copilot_0.2.1_x64-setup.exe      (Windows)
```

### CI build

The workflow `.github/workflows/tauri-desktop.yml` builds:

| OS | Targets | Artifacts |
|---|---|---|
| Linux (Ubuntu 22.04) | `.deb`, AppImage | `ftth-copilot-linux-deb`, `ftth-copilot-linux-appimage` |
| Windows (windows-latest) | NSIS, MSI | `ftth-copilot-windows-nsis`, `ftth-copilot-windows-msi` |

Tag pushes (`v*`) automatically attach all artifacts to the GitHub release.

### Customizing the API URL

The Tauri build reads `NEXT_PUBLIC_API_URL` at build time. To point the app at a hosted backend:

```bash
NEXT_PUBLIC_API_URL=https://api.ftth-copilot.example.com pnpm build
cd apps/web
NEXT_PUBLIC_API_URL=https://api.ftth-copilot.example.com pnpm tauri:build
```

If unset, the app defaults to `https://demo.ftth-copilot.com`.

## Plugins installed

| Package | Purpose |
|---|---|
| `tauri` | Core framework |
| `tauri-plugin-log` | Logging |
| `@tauri-apps/cli` | Build tooling |

## Known limitations

- **Code signing**: Both Linux and Windows builds are unsigned. SmartScreen will warn on Windows; users can dismiss.
- **WebView runtime**: Windows uses WebView2 (downloaded via bootstrapper). Linux uses WebKit2GTK 4.1.
- **Static export**: Same constraint as Capacitor — the app calls `/api/*` which requires a remote backend.
- **Distribution channels**: No app stores yet (Snap, Microsoft Store, etc.) — direct downloads via GitHub Releases only.

## Roadmap

1. ✅ Project structure, brand alignment, basic config
2. ✅ CI workflow for Linux + Windows builds
3. ⏳ Code signing for production releases
4. ⏳ System tray icon + global shortcuts
5. ⏳ App menu with platform-specific shortcuts
