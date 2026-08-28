import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUDIO_FILTER_CHAIN,
  analysisArguments,
  choosePreviewStart,
  exportArguments,
  findAvailableOutputPath,
  isSupportedAudioPath,
  isValidLoudnessTarget,
  parseLoudnormStats,
  parseProgressSeconds,
  parseSilenceIntervals,
  previewPlaybackGain,
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
    const analysis = analysisArguments("input file.wav", "NUL", -20);
    const output = exportArguments("input file.wav", "partial.mp3", {
      inputI: -24,
      inputTp: -3,
      inputLra: 5,
      inputThresh: -34,
      targetOffset: 0,
    }, -20);
    expect(analysis.join(" ")).toContain(AUDIO_FILTER_CHAIN);
    expect(output.join(" ")).toContain(AUDIO_FILTER_CHAIN);
    expect(output).toContain("libmp3lame");
    expect(output).toContain("128k");
    expect(output.join(" ")).toContain("measured_I=-24");
    expect(analysis.join(" ")).toContain("loudnorm=I=-20");
    expect(output.join(" ")).toContain("loudnorm=I=-20");
  });

  it("validates targets and converts LUFS differences into preview gain", () => {
    expect(isValidLoudnessTarget(-24)).toBe(true);
    expect(isValidLoudnessTarget(-16)).toBe(true);
    expect(isValidLoudnessTarget(-14)).toBe(true);
    expect(isValidLoudnessTarget(-13)).toBe(false);
    expect(isValidLoudnessTarget(-16.5)).toBe(false);
    expect(previewPlaybackGain(-14)).toBe(1);
    expect(previewPlaybackGain(-16)).toBeCloseTo(0.794, 3);
    expect(previewPlaybackGain(-24)).toBeCloseTo(0.316, 3);
  });

  it("chooses the nearest non-silent three-second window around the midpoint", () => {
    const intervals = parseSilenceIntervals(
      "silence_start: 28.4\nsilence_end: 32.1 | silence_duration: 3.7",
      60,
    );
    expect(intervals).toEqual([{ start: 28.4, end: 32.1 }]);
    const start = choosePreviewStart(120, 30, 60, intervals);
    expect(start).toBeGreaterThanOrEqual(55);
    expect(start + 3).toBeLessThanOrEqual(58.5);
  });

  it("uses all available audio for recordings shorter than three seconds", () => {
    expect(choosePreviewStart(2.25, 0, 2.25, [])).toBe(0);
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
