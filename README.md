# Sermon Audio Cleaner

Sermon Audio Cleaner is a private desktop application that turns a spoken-sermon recording into a cleaned, consistently leveled MP3. Processing is automatic after file selection and happens entirely on the local machine.

## What it does

- Accepts MP3, WAV, M4A/AAC, FLAC, OGG/Opus, and WebM audio up to 90 minutes.
- Converts the recording to mono at 48 kHz.
- Reduces steady hiss, fan noise, and hum with deterministic FFT filtering.
- Smooths large volume differences and applies measured two-pass normalization to −16 LUFS with a −1.5 dB true-peak target.
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
5. Measure `loudnorm` statistics during pass one, then apply those measurements during pass two.
6. Encode mono MP3 at 128 kbps and validate codec, sample rate, channels, and duration before the partial file is renamed.

## Privacy and files

The production renderer is context-isolated, has no Node.js access, blocks external navigation, and denies outbound HTTP(S) requests. Source recordings are read directly and never modified or copied into application storage. A failed or cancelled job removes only its uniquely named partial output.

## Distribution

Release builds are intentionally unsigned unless signing credentials are supplied. Windows SmartScreen and macOS Gatekeeper can therefore warn about development releases.

This project is licensed under GPL-3.0-or-later because it distributes GPL FFmpeg binaries. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
