# Task Orchestrator — Build Guide

This document explains how to build Task Orchestrator for all platforms.

## Prerequisites

### Common
- [Node.js](https://nodejs.org/) v18+ (LTS)
- [npm](https://www.npmjs.com/) v9+
- [Git](https://git-scm.com/)

### macOS
- [Rust](https://www.rust-lang.org/tools/install) (via rustup)
- Xcode Command Line Tools (`xcode-select --install`)

### Windows
- [Rust](https://www.rust-lang.org/tools/install) (via rustup)
- [Visual Studio 2022](https://visualstudio.microsoft.com/downloads/) with:
  - "Desktop development with C++" workload
  - Windows 10/11 SDK
  - MSVC v143 build tools
- Git for Windows

---

## Building for macOS

```bash
# From repository root
cd frontend/src-tauri
cargo tauri build
```

Output:
- DMG: `target/release/bundle/dmg/tto_0.1.0_aarch64.dmg`
- App: `target/release/bundle/macos/Task Orchestrator.app`

### Notarization (required for distribution)

```bash
# Create an app-specific password at https://appleid.apple.com
# Then run:
xcrun notarytool submit target/release/bundle/dmg/tto_0.1.0_aarch64.dmg \
  --apple-id "your@apple.id" \
  --password "@env:NOTARY_PASSWORD" \
  --team-id "YOUR_TEAM_ID" \
  --wait

# Staple the ticket
xcrun stapler staple target/release/bundle/macos/Task Orchestrator.app
```

---

## Building for Windows

**Important:** Windows builds must be done on a Windows machine (or via CI/CD). Cross-compilation from macOS is not supported due to Windows SDK requirements.

### Local build on Windows

```powershell
# From repository root
cd frontend\src-tauri
cargo tauri build --target x86_64-pc-windows-msvc
```

Or run the included script:
```powershell
.\build-scripts\build-windows.bat
```

Output:
- MSI: `target\release\bundle\msi\tto_0.1.0_x64-setup.exe`
- NSIS: `target\release\bundle\nsis\tto_0.1.0_x64\tto.exe`

### Code signing (recommended)

```powershell
signtool sign /fd SHA256 /tr http://timestamp.sectigo.com /td SHA256 ^
    "target\release\bundle\msi\tto_0.1.0_x64-setup.exe"
```

---

## CI/CD Builds

GitHub Actions workflows are provided in `.github/workflows/`:

- `build-macos.yml` — builds macOS DMG on push to `main` or tag
- `build-windows.yml` — builds Windows installer on push to `main` or tag
- `build-all.yml` — builds both platforms simultaneously

### Setting up CI/CD

1. Push your code to GitHub
2. Create a GitHub Personal Access Token with `repo` scope
3. Add the token as a secret: `Settings → Secrets and variables → Actions → New repository secret`
   - Name: `GH_TOKEN`
   - Value: your token
4. For macOS notarization, add these secrets:
   - `APPLE_ID` — your Apple ID
   - `APPLE_APP_PASSWORD` — app-specific password
   - `TEAM_ID` — your Apple Developer Team ID

---

## Updating Download URLs

After building, update the download URLs in `backend/version.json`:

```json
{
  "version": "0.1.0",
  "downloads": {
    "macos": "https://github.com/your-org/tto/releases/download/v0.1.0/tto_0.1.0_aarch64.dmg",
    "windows": "https://github.com/your-org/tto/releases/download/v0.1.0/tto_0.1.0_x64-setup.exe"
  }
}
```

The `/downloads` page and `/api/version` endpoint will automatically serve these URLs.

---

## Troubleshooting

### macOS: "developer id application cannot be verified"
Run: `xattr -cr /Applications/Task Orchestrator.app`

### Windows: "Windows protected your PC"
Right-click the installer → Properties → Check "Unblock" → Apply

### Frontend build fails
```bash
cd frontend
rm -rf node_modules
npm ci
npm run build
```

### Rust build fails
```bash
rustup update
cargo clean
cargo build --release
```
