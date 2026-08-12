# Third-party notices

Sermon Audio Cleaner includes open-source software. The application source and these notices must remain available with distributed builds.

## FFmpeg and FFprobe

The packaged executables are provided through `ffmpeg-static` 5.3.0 and `@derhuerst/ffprobe-static` 5.3.0. Those packages and their binaries are distributed under GPL-3.0-or-later.

- Wrapper and binary packaging source: <https://github.com/eugeneware/ffmpeg-static>
- FFmpeg source and license information: <https://ffmpeg.org/download.html>
- FFmpeg license: <https://ffmpeg.org/legal.html>

The application invokes these executables as separate processes and ships the associated GPL notice with every installer.

## Electron

Electron is Copyright OpenJS Foundation and Electron contributors and is distributed under the MIT License.

- Source: <https://github.com/electron/electron>
- License: <https://github.com/electron/electron/blob/main/LICENSE>

## React, Vite, and supporting packages

React, Vite, TypeScript, and the remaining JavaScript dependencies retain their respective notices and licenses. Exact versions and integrity hashes are recorded in `pnpm-lock.yaml`; license files remain present in the source dependency tree and packaged application where required.
