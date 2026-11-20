@echo off
setlocal
if "%~2"=="" goto usage
if "%~1"=="test" goto cargo
if not "%~1"=="build" goto usage
set TAURI_CONFIG={"bundle":{"externalBin":["binaries/lexorder-bun"]}}
:cargo
cargo.exe %~1 --locked --manifest-path "%~dp0..\..\desktop\personal-chronicle\desktop-preview\Cargo.toml" --target-dir "%~2"
exit /b %errorlevel%
:usage
>&2 echo Usage: chronicle-rust.cmd test^|build WindowsTargetDirectory
exit /b 2
