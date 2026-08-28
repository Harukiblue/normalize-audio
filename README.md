# Sermon Audio Cleaner

Sermon Audio Cleaner is a private desktop application that turns a spoken-sermon recording into a cleaned, consistently leveled MP3. It prepares a short volume preview before processing, and everything happens entirely on the local machine.

## Download and install

The ready-to-use desktop builds are available from GitHub Actions:

1. Sign in to GitHub with an account that has access to this private repository.
2. Open [Build desktop releases](https://github.com/Harukiblue/normalize-audio/actions/workflows/release.yml).
3. Select the newest successful run (marked with a green check).
4. Scroll to **Artifacts** and download the build for your computer:
   - `sermon-audio-cleaner-windows-x64` — 64-bit Windows.
   - `sermon-audio-cleaner-macos-arm64` — Apple Silicon Macs (M1, M2, M3, M4, or newer).
   - `sermon-audio-cleaner-macos-x64` — Intel Macs.
   - `sermon-audio-cleaner-linux-x64` — 64-bit Intel/AMD Linux.
5. Extract the downloaded ZIP before following the platform instructions below.

If you are unsure which Mac you have, open **Apple menu → About This Mac**. A value beginning with Apple M under **Chip** means Apple Silicon; a value under **Processor** that mentions Intel means Intel.

### Windows

1. Open the extracted `Sermon Audio Cleaner-...-Windows-x64.exe` installer.
2. Follow the installer prompts and then launch **Sermon Audio Cleaner** from the Start menu.
3. Because the installer is not code-signed, Windows may show a Microsoft Defender SmartScreen warning. Confirm that the publisher is listed as unknown, choose **More info**, and then choose **Run anyway** only if you downloaded the file from this repository.

### macOS

1. Open the extracted `Sermon Audio Cleaner-...-macOS-....dmg` file.
2. Drag **Sermon Audio Cleaner** into the **Applications** folder, then eject the disk image.
3. Open the app from **Applications**. Because the app is not signed or notarized, macOS may block the first launch. In **System Settings → Privacy & Security**, find the message about Sermon Audio Cleaner, choose **Open Anyway**, then confirm **Open**. Only bypass this warning when the DMG came from this repository.

### Linux

The Linux build is an AppImage and does not require installation. Extract the ZIP, open a terminal in that folder, and run:

```sh
chmod +x "Sermon Audio Cleaner-"*.AppImage
./"Sermon Audio Cleaner-"*.AppImage
```

You can move the AppImage to a permanent folder before running it. If your distribution reports a FUSE-related error, use the AppImage's portable fallback:

```sh
./"Sermon Audio Cleaner-"*.AppImage --appimage-extract-and-run
```

### Clean a sermon

1. Choose **Choose recording** (or drop an audio file onto the window).
2. Play the cleaned three-second sample selected near the middle of the recording.
3. Move **Output volume** from −24 to −14 LUFS if needed. The default remains −16 LUFS.
4. Choose **Clean full recording** and wait while the whole sermon is cleaned and normalized to the selected target.
5. When processing finishes, use **Show in folder** to find the new `-cleaned.mp3` file beside the original recording. The original file is never modified.

## What it does

- Accepts MP3, WAV, M4A/AAC, FLAC, OGG/Opus, and WebM audio up to 90 minutes.
- Converts the recording to mono at 48 kHz.
- Reduces steady hiss, fan noise, and hum with deterministic FFT filtering.
- Prepares a cleaned three-second speech preview near the midpoint for choosing output volume.
- Smooths large volume differences and applies measured two-pass normalization from −24 to −14 LUFS (default −16) with a −1.5 dB true-peak target.
- Saves a 128 kbps MP3 beside the source without ever overwriting an existing file.
- Uses no AI model, cloud API, account, telemetry, or runtime network connection.

The denoiser is deliberately conservative. It cannot reliably remove overlapping voices, sudden interruptions, or heavy room reverberation.

## Development

Requirements: Node.js 24+ and pnpm 11. FFmpeg and FFprobe are downloaded as pinned project dependencies; a system installation is not required.

```sh
pnpm install
pnpm dev
```

Verification commands:

```sh
pnpm test
pnpm build
pnpm test:e2e
```

Create an installer for the current operating system with `pnpm dist`. Platform-specific scripts are also available as `dist:win`, `dist:mac`, and `dist:linux`.

An optional full-length packaged-app validation can be run against a locally downloaded sermon:

```powershell
$env:PACKAGED_ELECTRON_PATH="C:\path\to\Sermon Audio Cleaner.exe"
$env:REAL_SERMON_PATH="C:\path\to\sermon.mp3"
pnpm exec playwright test tests/e2e/real-sermon.spec.ts
```

The real-sermon test is excluded from routine CI unless `REAL_SERMON_PATH` is set.

## Processing pipeline

The exact cleanup preset lives in `electron/audio-utils.ts`. Both passes use the same input chain:

1. Resample to mono, 48 kHz floating-point audio.
2. Remove sub-70 Hz rumble and frequencies above 16 kHz.
3. Apply FFmpeg `afftdn` with automatic noise and residual tracking.
4. Apply conservative `dynaudnorm` leveling with a four-times gain ceiling and a silence threshold.
5. Measure `loudnorm` statistics for the selected target during pass one, then apply those measurements during pass two.
6. Encode mono MP3 at 128 kbps and validate codec, sample rate, channels, and duration before the partial file is renamed.

## Privacy and files

The production renderer is context-isolated, has no Node.js access, blocks external navigation, and denies outbound HTTP(S) requests. Source recordings are read directly and never modified or copied into application storage. A failed or cancelled job removes only its uniquely named partial output.

## Distribution

Release builds are intentionally unsigned unless signing credentials are supplied. Windows SmartScreen and macOS Gatekeeper can therefore warn about development releases.

This project is licensed under GPL-3.0-or-later because it distributes GPL FFmpeg binaries. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
