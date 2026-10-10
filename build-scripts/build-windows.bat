# tto — Windows Build Script
# Run this on a Windows 10/11 machine with the required toolchain installed.

@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo   tto — Windows Build Script
echo ============================================================
echo.

:: Check for required tools
echo [1/5] Checking prerequisites...
call :check_tool cargo "Cargo (Rust)" || exit /b 1
call :check_tool node "Node.js (v18+)" || exit /b 1
call :check_tool npm "npm" || exit /b 1
call :check_tool git "Git" || exit /b 1

:: Anchor to repo root for consistent navigation
set "REPO_ROOT=%~dp0.."
echo   Repo root: %REPO_ROOT%

:: Ensure correct Rust target is installed
rustup target add x86_64-pc-windows-msvc >nul 2>&1

echo.
echo [2/5] Installing frontend dependencies...
cd /d "%REPO_ROOT%\frontend"
call npm ci
if errorlevel 1 (
    echo ERROR: npm ci failed
    exit /b 1
)

echo.
echo [3/5] Building frontend...
call npm run build
if errorlevel 1 (
    echo ERROR: frontend build failed
    exit /b 1
)

echo.
echo [4/5] Building Tauri Windows app...
cd /d "%REPO_ROOT%\frontend\src-tauri"
cargo tauri build --target x86_64-pc-windows-msvc --bundles app,msi
if errorlevel 1 (
    echo ERROR: Tauri build failed
    exit /b 1
)

echo.
echo [5/5] Build complete!
echo.
echo Output locations:
echo   - MSI Installer: ..\..\..\target\release\bundle\msi\tto_0.1.0_x64-setup.exe
echo   - App Bundle:    ..\..\..\target\release\bundle\nsis\tto_0.1.0_x64\tto.exe
echo.
echo To sign the installer (recommended for distribution):
echo   signtool sign /fd SHA256 /tr http://timestamp.sectigo.com /td SHA256 ^
echo       "..\..\..\target\release\bundle\msi\tto_0.1.0_x64-setup.exe"
echo.

exit /b 0

:: Helper function to check if a tool exists
:check_tool
set "TOOL=%~1"
set "DESC=%~2"
where %TOOL% >nul 2>&1
if errorlevel 1 (
    echo   ERROR: %DESC% not found. Install it first.
    exit /b 1
)
for /f "tokens=*" %%i in ('%TOOL% --version 2^>^&1 ^| findstr /i "version"') do (
    echo   Found: %DESC% - %%i
)
exit /b 0
