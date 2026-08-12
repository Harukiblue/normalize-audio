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

const run = promisify(execFile);
let directory: string;
let sourcePath: string;
let outputPath: string;

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
  outputPath = path.join(directory, "Uneven noisy sermon-cleaned.partial.mp3");

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

  const analysis = await ffmpeg(
    analysisArguments(sourcePath, process.platform === "win32" ? "NUL" : "/dev/null"),
  );
  const measurements = parseLoudnormStats(analysis.stderr);
  await ffmpeg(exportArguments(sourcePath, outputPath, measurements));
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
      outputPath,
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

  it("lands within the spoken-audio loudness and true-peak targets", async () => {
    const measured = await ffmpeg([
      "-hide_banner",
      "-i",
      outputPath,
      "-af",
      "loudnorm=I=-16:LRA=7:TP=-1.5:print_format=json",
      "-f",
      "null",
      process.platform === "win32" ? "NUL" : "/dev/null",
    ]);
    const stats = parseLoudnormStats(measured.stderr);
    expect(stats.inputI).toBeGreaterThanOrEqual(-17);
    expect(stats.inputI).toBeLessThanOrEqual(-15);
    expect(stats.inputTp).toBeLessThanOrEqual(-1);
  });
});
