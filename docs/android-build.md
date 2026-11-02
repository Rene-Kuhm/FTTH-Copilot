# Android Build — Capacitor

FTTH-Copilot is distributed as an Android APK using [Capacitor](https://capacitorjs.com/), which wraps the Next.js web build in a native Android WebView.

## Architecture

```
┌─────────────────────────────────────────────┐
│  apps/web (Next.js + Capacitor)             │
│  ├── app/         Next.js App Router         │
│  ├── components/  Shared UI                  │
│  ├── lib/         Auth, connectors, etc.     │
│  ├── capacitor.config.ts                     │
│  └── android/     Native Android project     │
│       └── app/                               │
│           └── src/main/res/values/colors.xml │
└─────────────────────────────────────────────┘
```

The Capacitor config (`capacitor.config.ts`) is at the root of `apps/web/`. The Android project lives in `apps/web/android/`.

## Brand alignment

The Android native theme is wired to the FTTH-Copilot design tokens:

| Token | Hex | Android resource |
|---|---|---|
| `--color-bg` | `#1a1218` | `@color/colorBg`, `@color/splashBackground` |
| `--color-surface` | `#20161e` | (web layer only) |
| `--color-accent` | `#f23077` | `@color/colorAccent` |
| `--color-text` | `#f6eff3` | `@color/colorText` |
| `--color-muted` | `#7b4d68` | `@color/colorMuted` |

The launcher icon (`drawable-v24/ic_launcher_foreground.xml`) uses the brand pink `#f23077` for the signal/network glyph.

## Building the APK

### Prerequisites

- Node.js 22
- pnpm 11
- JDK 17 (Temurin recommended)
- Android SDK with platform-tools, build-tools 34, platform 34
- `ANDROID_HOME` environment variable set

### Local build

```bash
# 1. Install dependencies
pnpm install --frozen-lockfile

# 2. Build the static Next.js export
cd apps/web
pnpm build:static

# 3. Sync the web build into the Android project
pnpm cap:sync

# 4. Build the APK
cd android
./gradlew assembleDebug          # Debug APK
./gradlew assembleRelease        # Unsigned release APK
```

The APK is generated at:
- Debug: `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`
- Release: `apps/web/android/app/build/outputs/apk/release/app-release-unsigned.apk`

### CI build

The compile steps live in the composite action
`.github/actions/android-build/action.yml`. Two workflows use it:

- `.github/workflows/android-apk.yml` — validation build: on every push to
  `main`, `design-system-v1`, or `capacitor-android`, and on PRs touching
  `apps/web/**`. Nothing is signed here.
- `.github/workflows/build-android.yml` — the release builder: a reusable
  workflow that compiles **and** signs, so the provenance attributes the
  builder that actually produced the APK. It is called by `release.yml`,
  which is dispatched by `release-please.yml` when a release is published
  (and also fires on a tag push matching `v*`). The APKs are attested (SLSA
  Build Level 3, keyless) and attached to the release.

The validation build does **not** call `build-android.yml`. GitHub validates
the run graph before creating any job, and a reusable workflow that requests
`id-token: write` forces every caller to grant it — a pull request could then
mint an OIDC token. The composite action is what keeps the two paths
compiling the same bytes with different permissions.

Artifacts:
- `ftth-copilot-android-debug` — debug APK (always built)
- `ftth-copilot-android-release` — unsigned release APK

Publishing a release attaches the APKs to the GitHub release: `release-please.yml`
dispatches `release.yml`, which builds them, atests them and uploads them.

### Customizing the API URL

The Capacitor build reads `NEXT_PUBLIC_API_URL` at build time. To point the APK at a hosted backend:

```bash
NEXT_PUBLIC_API_URL=https://api.ftth-copilot.example.com pnpm build:static
```

If unset, the APK defaults to `https://demo.ftth-copilot.com`.

## Plugins installed

| Package | Purpose |
|---|---|
| `@capacitor/core` | Capacitor runtime |
| `@capacitor/cli` | Build tooling |
| `@capacitor/app` | App lifecycle events |
| `@capacitor/haptics` | Haptic feedback |
| `@capacitor/status-bar` | Status bar styling |
| `@capacitor/keyboard` | Keyboard behavior |
| `@capacitor-community/sqlite` | Local SQLite (offline cache) |

## Known limitations

- **Static export only**: The current build uses `output: 'export'`, so API routes are not bundled. The APK must point at a remote backend via `NEXT_PUBLIC_API_URL`.
- **No offline mode yet**: All `/api/*` calls require network connectivity. SQLite plugin is wired but offline-first caching is not implemented in the app yet.
- **Unsigned release**: The release APK is unsigned by default. For Play Store or managed enterprise distribution, configure a signing config in `apps/web/android/app/build.gradle` and publish the signed artifact separately.

## Roadmap

1. ✅ Project structure, theme, brand alignment
2. ✅ CI workflow for APK builds
3. ⏳ Implement offline-first SQLite caching
4. ⏳ Add release signing config
5. ⏳ Optional: feature parity with the demo mode for full offline operation
