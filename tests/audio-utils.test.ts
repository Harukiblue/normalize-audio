import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUDIO_FILTER_CHAIN,
  analysisArguments,
  exportArguments,
  findAvailableOutputPath,
  isSupportedAudioPath,
  parseLoudnormStats,
  parseProgressSeconds,
  progressPercent,
} from "../electron/audio-utils";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("audio processing utilities", () => {
  it("recognizes the supported recording extensions case-insensitively", () => {
    expect(isSupportedAudioPath("Sunday Sermon.MP3")).toBe(true);
    expect(isSupportedAudioPath("sermon.m4a")).toBe(true);
    expect(isSupportedAudioPath("service.mp4")).toBe(false);
  });

  it("parses the final loudnorm measurement block", () => {
    const stderr = `noise before\n{
      "input_i" : "-25.40",
      "input_tp" : "-4.10",
      "input_lra" : "3.20",
      "input_thresh" : "-35.70",
      "target_offset" : "0.30"
    }`;
    expect(parseLoudnormStats(stderr)).toEqual({
      inputI: -25.4,
      inputTp: -4.1,
      inputLra: 3.2,
      inputThresh: -35.7,
      targetOffset: 0.3,
    });
  });

  it("rejects silent, unmeasurable audio", () => {
    expect(() =>
      parseLoudnormStats(`{
        "input_i" : "-inf",
        "input_tp" : "-inf",
        "input_lra" : "0.00",
        "input_thresh" : "-70.00",
        "target_offset" : "inf"
      }`),
    ).toThrow(/silent|loudness/i);
  });

  it("builds both passes with the same deterministic cleanup chain", () => {
    const analysis = analysisArguments("input file.wav", "NUL");
    const output = exportArguments("input file.wav", "partial.mp3", {
      inputI: -24,
      inputTp: -3,
      inputLra: 5,
      inputThresh: -34,
      targetOffset: 0,
    });
    expect(analysis.join(" ")).toContain(AUDIO_FILTER_CHAIN);
    expect(output.join(" ")).toContain(AUDIO_FILTER_CHAIN);
    expect(output).toContain("libmp3lame");
    expect(output).toContain("128k");
    expect(output.join(" ")).toContain("measured_I=-24");
  });

  it("parses FFmpeg progress and maps it into a stage range", () => {
    expect(parseProgressSeconds("out_time_us=15000000")).toBe(15);
    expect(parseProgressSeconds("out_time=00:01:30.500000")).toBe(90.5);
    expect(progressPercent(45, 90, 5, 50)).toBe(27.5);
    expect(progressPercent(500, 90, 50, 96)).toBe(96);
  });

  it("never overwrites an existing cleaned recording", async () => {
    const directory = path.join(os.tmpdir(), `sermon-cleaner-unit-${Date.now()}`);
    temporaryDirectories.push(directory);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "sermon-cleaned.mp3"), "existing");

    await expect(findAvailableOutputPath(path.join(directory, "sermon.wav"), directory)).resolves.toBe(
      path.join(directory, "sermon-cleaned-2.mp3"),
    );
  });
});
