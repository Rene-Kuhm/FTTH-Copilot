# Multi-Platform Expansion Roadmap — FTTH-Copilot

## Goal

Expand FTTH-Copilot from a web-only application to a multi-platform product:
web + Android (Capacitor) + Linux + Windows (Tauri).

**Scope: free, no stores, no Apple hardware.**
- Android: APK via GitHub Releases
- Linux: .deb via GitHub Releases
- Windows: .msi/.exe via GitHub Releases
- macOS/iOS: excluded (require macOS build machine)

## Decision Record

### D1 — Monorepo structure: 3 apps, shared packages

```
FTTH-Copilot/
├── apps/
│   ├── web/          # Next.js (existing)
│   ├── capacitor/    # Capacitor wrapper (Android only)
│   └── tauri/        # Tauri wrapper (Linux, Windows)
├── packages/          # All shared code (existing)
└── turbo.json        # Extended with new build targets
```

Every app shares 100% of business logic from `packages/*`. The wrappers are thin
native shells that load the Next.js build. Zero duplication of UI components.

### D2 — Build from static Next.js export

All three platforms serve the same Next.js build (static export).

| Platform | Wrapper | Runtime |
|---|---|---|
| Web | Vercel / node | Next.js SSR/SSG |
| Android | Capacitor (WebView) | Same Next.js build |
| Linux | Tauri (WebView) | Same Next.js build |
| Windows | Tauri (WebView2) | Same Next.js build |

### D3 — Platform-aware UI layer

Add a lightweight abstraction in `packages/shared` to handle platform differences:

```ts
// packages/shared/src/platform/index.ts
export type Platform = 'web' | 'android' | 'linux' | 'windows'
export const platform: Platform = detectPlatform()
export const isMobile = platform === 'android'
export const isDesktop = ['linux', 'windows'].includes(platform)
export const isNative = isMobile || isDesktop
```

Conditional rendering only for: navigation patterns, window chrome, native
notifications, offline indicators. NOT for business logic.

### D4 — Offline-first with local SQLite

| Platform | Solution |
|---|---|
| Capacitor (Android) | `@capacitor-community/sql` |
| Tauri (Linux/Windows) | `tauri-plugin-sql` |

Use cases: cache last 24h of metrics, pending investigations buffer, alert buffering.

### D5 — Single Tauri app for Linux + Windows

One binary set, two targets. Tauri builds to:
- `ftth-copilot_x.x.x_amd64.deb` → Ubuntu/Debian
- `ftth-copilot_x.x.x_x64_en-US.msi` → Windows
- `ftth-copilot_x.x.x_x64-setup.exe` → Windows NSIS installer

No separate repos, no separate CI pipelines.

**Windows SmartScreen warning:** Without code signing (~€80/year), Windows SmartScreen
shows a warning on first run. Harmless. Resolvable later if needed.

### D6 — CI/CD: GitHub Actions

```
on: [push, pull_request]
jobs:
  build-android:
    runs-on: ubuntu-latest
    steps: [cap:build → upload to GitHub Release]

  build-desktop:
    strategy:
      matrix: platform: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.platform }}
    steps: [tauri:build → upload to GitHub Release]
```

### D7 — Distribution: GitHub Releases only

| Platform | Channel |
|---|---|
| Web | Vercel auto-deploy |
| Android | GitHub Releases (.apk) |
| Linux | GitHub Releases (.deb) |
| Windows | GitHub Releases (.msi) |

No App Store, no Google Play, no Microsoft Store.

---

## Phase 1 — Preparation

**Goal:** Make the Next.js app build-ready for static export.

### 1.1 PWA foundation
- Add `@ducanh2912/next-pwa`
- Configure service worker for offline shell
- Generate `manifest.json` with icons (all required sizes)
- Test Lighthouse PWA score ≥ 90

### 1.2 Environment abstraction
- Extract API base URL to `NEXT_PUBLIC_API_URL`
- Add `NEXT_PUBLIC_PLATFORM_MODE: 'web' | 'standalone'`
- In standalone mode: works without NMS connection, uses local SQLite
- Add platform detection in `packages/shared/src/platform`

### 1.3 Mobile-optimized layout
- Audit responsive breakpoints; add tablet (768–1024px) variant
- Test on real Android Chrome
- Fix CSS issues for mobile viewport
- Touch targets ≥ 44px

### 1.4 Next.js static export config
- Configure `output: 'export'` or standalone mode
- Ensure API routes degrade gracefully in standalone mode
- Test `pnpm build` produces valid static output

**Deliverable:** `apps/web` builds to static export, opens correctly in Capacitor
and Tauri shells locally.

---

## Phase 2 — Capacitor (Android)

**Goal:** Android app building from the same Next.js build.

### 2.1 Project setup
```bash
cd apps/capacitor
pnpm add @capacitor/core @capacitor/cli @capacitor/app @capacitor/haptics
pnpm add @capacitor-community/sql
pnpm add @capacitor-community/local-notifications
npx cap init "FTTH-Copilot" "com.ftthcopilot.app" --web-dir=../web/out
npx cap add android
```

### 2.2 Android project
- `npx cap copy android && npx cap open android` (opens Android Studio)
- Configure `AndroidManifest.xml`: INTERNET, ACCESS_NETWORK_STATE
- Generate unsigned APK for GitHub Release
- Add app icons (1024×1024 source → all sizes via Android Studio)

### 2.3 Capacitor-specific UI
- Custom `App` component with mobile navigation patterns
- Status bar / navigation bar integration
- Pull-to-refresh on data lists
- Offline banner (shown when `navigator.onLine === false`)
- Bottom tab navigation for mobile (vs sidebar on web)

### 2.4 Offline sync logic
- On app start: load last cached metrics from SQLite
- On network restore: sync pending investigations to server
- Background fetch: periodic metric polling when app is open

**Deliverable:** `.apk` builds successfully. GitHub Releases ready.

---

## Phase 3 — Tauri (Linux + Windows)

**Goal:** Single app targeting Linux and Windows.

### 3.1 Project setup
```bash
cd apps/tauri
npm create tauri-app@latest . -- --template vanilla-ts --manager pnpm
# App name: ftth-copilot, identifier: com.ftthcopilot.desktop
pnpm add @tauri-apps/api
pnpm add @tauri-apps/plugin-sql
pnpm add @tauri-apps/plugin-notification
pnpm add @tauri-apps/plugin-os
pnpm add @tauri-apps/plugin-autostart
```

Configure `tauri.conf.json`:
```json
{
  "productName": "FTTH-Copilot",
  "identifier": "com.ftthcopilot.desktop",
  "build": {
    "devUrl": "http://localhost:3000",
    "frontendDist": "../web/out"
  },
  "app": {
    "windows": [{ "title": "FTTH-Copilot", "width": 1280, "height": 800 }],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' https://*"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis", "deb"],
    "linux": { "appimage": { "bundleMediaFramework": false } }
  }
}
```

### 3.2 Desktop-specific UI
- Native window frame with proper close/minimize/maximize
- System tray icon with context menu (quick diagnostics, quit)
- Auto-launch on system start (configurable)
- Global shortcut: `Ctrl+Shift+F` → open app
- Desktop notifications for critical alerts
- App menu with keyboard shortcuts

### 3.3 Offline + local data
- SQLite local cache for metrics and investigations
- Offline indicator in title bar
- Export diagnostics report to local PDF/CSV

### 3.4 CI/CD
```yaml
# .github/workflows/desktop.yml
- name: Build Tauri
  uses: tauri-apps/tauri-action@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    tagName: ${{ github.ref_name }}
    releaseName: 'FTTH-Copilot v__VERSION__'
    releaseDraft: true
```

**Deliverable:** `.msi`, `.deb` builds from CI, installable on Linux and Windows.

---

## Phase 4 — Polish and Distribution

### 4.1 Release assets per platform

| Platform | File | Where |
|---|---|---|
| Android | `ftth-copilot.apk` | GitHub Release |
| Linux | `ftth-copilot_x.x.x_amd64.deb` | GitHub Release |
| Windows | `ftth-copilot_x.x.x_x64-setup.exe` | GitHub Release |
| Web | Vercel auto-deploy | vercel.app |

### 4.2 Release notes template
Each GitHub Release includes:
- What's new (changelog entries)
- Download links per platform
- Minimum requirements (OS version, RAM, disk)
- How to install (instructions per OS)

### 4.3 Version plan

| Version | Platforms | Milestone |
|---|---|---|
| v0.2.0 | Web + Android APK | First mobile release |
| v0.3.0 | + Linux .deb + Windows .msi | First desktop release |
| v1.0.0 | All platforms stable | Post-pilot |

---

## Scope Constraints

**In scope:**
- Static export from existing Next.js build
- Capacitor shell for Android
- Tauri shell for Linux and Windows
- Platform-aware UI layer (navigation, notifications)
- Offline local cache via SQLite
- CI/CD for all platforms
- GitHub Releases distribution

**Out of scope:**
- Rewrite of existing Next.js components
- macOS app (requires macOS build machine)
- iOS app (requires macOS + Xcode)
- App stores (Google Play, Apple Store, Microsoft Store)
- Native hardware access (Bluetooth fiber diagnostics) — future phase
- Code signing (Windows SmartScreen warning acceptable for now)

---

## Effort Estimate

| Phase | Effort |
|---|---|
| Phase 1 (PWA + static export) | 1 week |
| Phase 2 (Capacitor Android) | 1-2 weeks |
| Phase 3 (Tauri Linux + Windows) | 1-2 weeks |
| Phase 4 (Polish + distribution) | 1 week |
| **Total** | **4-6 weeks** |

**Prerequisites:** None. All tools are free. macOS/iOS excluded — require Apple hardware.

---

## Verification

Each phase ends with:
1. App installs and launches on target platform
2. Demo data visible in offline mode
3. CI pipeline produces signed artifact
4. `pnpm lint && pnpm typecheck && pnpm test` all pass
