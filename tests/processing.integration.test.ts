import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "@derhuerst/ffprobe-static";
import {
  analysisArguments,
  exportArguments,
  parseLoudnormStats,
} from "../electron/audio-utils";
import { AudioProcessor } from "../electron/processor";

const run = promisify(execFile);
let directory: string;
let sourcePath: string;
const outputPaths = new Map<number, string>();
let previewSourcePath: string;

async function ffmpeg(args: string[]) {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not provide a binary.");
  return run(ffmpegPath, args, { maxBuffer: 16 * 1024 * 1024 });
}

async function ffprobe(args: string[]) {
  if (!ffprobePath) throw new Error("ffprobe-static did not provide a binary.");
  return run(ffprobePath, args, { maxBuffer: 4 * 1024 * 1024 });
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "sermon-cleaner-integration-"));
  sourcePath = path.join(directory, "Uneven noisy sermon.wav");

  await ffmpeg([
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=210:duration=8:sample_rate=48000",
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=color=white:amplitude=0.012:duration=8:sample_rate=48000",
    "-filter_complex",
    "[0:a]volume='if(lt(t,4),0.10,0.65)':eval=frame[voice];[voice][1:a]amix=inputs=2:normalize=0",
    "-c:a",
    "pcm_s16le",
    sourcePath,
  ]);

  for (const target of [-24, -16, -14]) {
    const outputPath = path.join(directory, `Uneven noisy sermon-${Math.abs(target)}.mp3`);
    const analysis = await ffmpeg(
      analysisArguments(sourcePath, process.platform === "win32" ? "NUL" : "/dev/null", target),
    );
    const measurements = parseLoudnormStats(analysis.stderr);
    await ffmpeg(exportArguments(sourcePath, outputPath, measurements, target));
    outputPaths.set(target, outputPath);
  }

  previewSourcePath = path.join(directory, "Midpoint pause.wav");
  await ffmpeg([
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=240:duration=70:sample_rate=48000",
    "-af",
    "volume='if(between(t,33.5,36.5),0,0.25)':eval=frame",
    "-c:a",
    "pcm_s16le",
    previewSourcePath,
  ]);
}, 45_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("real FFmpeg cleanup pipeline", () => {
  it("ships every deterministic filter and encoder required by the preset", async () => {
    const filters = await ffmpeg(["-hide_banner", "-filters"]);
    const encoders = await ffmpeg(["-hide_banner", "-encoders"]);
    expect(filters.stdout).toContain("afftdn");
    expect(filters.stdout).toContain("dynaudnorm");
    expect(filters.stdout).toContain("loudnorm");
    expect(encoders.stdout).toContain("libmp3lame");
  });

  it("creates the promised mono 48 kHz MP3 without duration drift", async () => {
    const { stdout } = await ffprobe([
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      outputPaths.get(-16)!,
    ]);
    const probe = JSON.parse(stdout) as {
      streams: Array<{ codec_name: string; sample_rate: string; channels: number }>;
      format: { duration: string };
    };
    expect(probe.streams[0].codec_name).toBe("mp3");
    expect(Number(probe.streams[0].sample_rate)).toBe(48_000);
    expect(probe.streams[0].channels).toBe(1);
    expect(Math.abs(Number(probe.format.duration) - 8)).toBeLessThan(0.15);
  });

  it("lands within each selectable loudness target and the peak ceiling", async () => {
    for (const target of [-24, -16, -14]) {
      const measured = await ffmpeg([
        "-hide_banner",
        "-i",
        outputPaths.get(target)!,
        "-af",
        `loudnorm=I=${target}:LRA=7:TP=-1.5:print_format=json`,
        "-f",
        "null",
        process.platform === "win32" ? "NUL" : "/dev/null",
      ]);
      const stats = parseLoudnormStats(measured.stderr);
      expect(stats.inputI).toBeGreaterThanOrEqual(target - 1);
      expect(stats.inputI).toBeLessThanOrEqual(target + 1);
      expect(stats.inputTp).toBeLessThanOrEqual(-1);
    }
  });

  it("creates a three-second cleaned preview away from midpoint silence and removes it", async () => {
    if (!ffmpegPath || !ffprobePath) throw new Error("Bundled processors are unavailable.");
    const processor = new AudioProcessor({
      ffmpegPath,
      ffprobePath,
      downloadsDirectory: directory,
      previewDirectory: path.join(directory, "previews"),
      emit: () => undefined,
    });
    const preview = await processor.preparePreview(previewSourcePath);
    expect(preview.sampleDurationSeconds).toBe(3);
    expect(
      preview.sampleStartSeconds + preview.sampleDurationSeconds <= 33.5 ||
      preview.sampleStartSeconds >= 36.5,
    ).toBe(true);
    const previewPath = processor.previewPathFor(preview.previewId);
    expect(previewPath).toBeTruthy();
    const probe = await ffprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      previewPath!,
    ]);
    expect(Number((JSON.parse(probe.stdout) as { format: { duration: string } }).format.duration)).toBeCloseTo(3, 1);
    const measured = await ffmpeg([
      "-hide_banner",
      "-i",
      previewPath!,
      "-af",
      "loudnorm=I=-14:LRA=7:TP=-1.5:print_format=json",
      "-f",
      "null",
      process.platform === "win32" ? "NUL" : "/dev/null",
    ]);
    expect(parseLoudnormStats(measured.stderr).inputI).toBeGreaterThanOrEqual(-15);
    expect(() => processor.start(preview.previewId, -13)).toThrow(/between -24 and -14/i);
    await processor.discardPreview(preview.previewId);
    expect(processor.previewPathFor(preview.previewId)).toBeNull();
  });
});
