import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import type { Stats } from "node:fs";
import {
  isValidLoudnessTarget,
  LOUDNESS_TARGET,
  previewPlaybackGain,
} from "../src/loudness";

export { isValidLoudnessTarget, LOUDNESS_TARGET, previewPlaybackGain };

export const SUPPORTED_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
  ".webm",
]);

export const AUDIO_FILTER_CHAIN = [
  "aresample=48000",
  "aformat=sample_fmts=fltp:channel_layouts=mono",
  "highpass=f=70",
  "lowpass=f=16000",
  "afftdn=nr=12:nf=-50:tn=1:tr=1:gs=8",
  "dynaudnorm=f=500:g=31:p=0.95:m=4:r=0.1:s=6:t=0.01:c=1",
].join(",");

export const PREVIEW_DURATION_SECONDS = 3;
export const PREVIEW_SEARCH_RADIUS_SECONDS = 30;

export interface SilenceInterval {
  start: number;
  end: number;
}

export interface LoudnormStats {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

interface RawLoudnormStats {
  input_i?: string;
  input_tp?: string;
  input_lra?: string;
  input_thresh?: string;
  target_offset?: string;
}

export function isSupportedAudioPath(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function parseSilenceIntervals(stderr: string, scanDuration: number): SilenceInterval[] {
  const events = [...stderr.matchAll(/silence_(start|end):\s*([\d.]+)/g)];
  const intervals: SilenceInterval[] = [];
  let openStart: number | null = null;

  for (const event of events) {
    const value = Math.max(0, Math.min(scanDuration, Number(event[2])));
    if (!Number.isFinite(value)) continue;
    if (event[1] === "start") {
      openStart = value;
    } else if (openStart !== null && value >= openStart) {
      intervals.push({ start: openStart, end: value });
      openStart = null;
    }
  }
  if (openStart !== null) intervals.push({ start: openStart, end: scanDuration });
  return intervals;
}

function overlapSeconds(start: number, end: number, intervals: SilenceInterval[]): number {
  return intervals.reduce(
    (total, interval) => total + Math.max(0, Math.min(end, interval.end) - Math.max(start, interval.start)),
    0,
  );
}

export function choosePreviewStart(
  durationSeconds: number,
  scanStartSeconds: number,
  scanDurationSeconds: number,
  silenceIntervals: SilenceInterval[],
): number {
  const sampleDuration = Math.min(PREVIEW_DURATION_SECONDS, durationSeconds);
  if (durationSeconds <= sampleDuration) return 0;

  const maximumLocalStart = Math.max(0, scanDurationSeconds - sampleDuration);
  const exactStart = Math.min(
    maximumLocalStart,
    Math.max(0, durationSeconds / 2 - sampleDuration / 2 - scanStartSeconds),
  );
  const candidates = new Set<number>([exactStart]);
  for (let start = 0; start <= maximumLocalStart + 0.001; start += 0.5) {
    candidates.add(Math.min(maximumLocalStart, Math.round(start * 2) / 2));
  }

  const ranked = [...candidates].map((start) => ({
    start,
    silence: overlapSeconds(start, start + sampleDuration, silenceIntervals),
    midpointDistance: Math.abs(scanStartSeconds + start + sampleDuration / 2 - durationSeconds / 2),
  }));
  ranked.sort((left, right) =>
    left.silence - right.silence ||
    left.midpointDistance - right.midpointDistance ||
    left.start - right.start,
  );
  return Math.max(0, Math.min(durationSeconds - sampleDuration, scanStartSeconds + ranked[0].start));
}

export function cleanedBaseName(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  return `${parsed.name}-cleaned`;
}

export async function findAvailableOutputPath(
  sourcePath: string,
  preferredDirectory: string,
): Promise<string> {
  const baseName = cleanedBaseName(sourcePath);

  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const label = suffix === 1 ? baseName : `${baseName}-${suffix}`;
    const candidate = path.join(preferredDirectory, `${label}.mp3`);
    try {
      await access(candidate, fsConstants.F_OK);
    } catch {
      return candidate;
    }
  }

  throw new Error("Could not find an available output filename.");
}

export function parseLoudnormStats(stderr: string): LoudnormStats {
  const matches = stderr.match(/\{\s*"input_i"[\s\S]*?\}/g);
  if (!matches?.length) {
    throw new Error("FFmpeg did not return loudness measurements.");
  }

  const raw = JSON.parse(matches.at(-1) ?? "{}") as RawLoudnormStats;
  const values = {
    inputI: Number(raw.input_i),
    inputTp: Number(raw.input_tp),
    inputLra: Number(raw.input_lra),
    inputThresh: Number(raw.input_thresh),
    targetOffset: Number(raw.target_offset),
  };

  if (Object.values(values).some((value) => !Number.isFinite(value))) {
    throw new Error("The recording is silent or its loudness could not be measured.");
  }

  return values;
}

export function silenceScanArguments(
  inputPath: string,
  startSeconds: number,
  durationSeconds: number,
  nullTarget: string,
): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-ss",
    String(startSeconds),
    "-t",
    String(durationSeconds),
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-af",
    "highpass=f=70,lowpass=f=16000,silencedetect=noise=-45dB:d=0.35",
    "-f",
    "null",
    nullTarget,
  ];
}

export function analysisArguments(
  inputPath: string,
  nullTarget: string,
  targetLufs: number = LOUDNESS_TARGET.defaultIntegrated,
  segment?: { startSeconds: number; durationSeconds: number },
): string[] {
  if (!isValidLoudnessTarget(targetLufs)) throw new Error("Invalid loudness target.");
  return [
    "-hide_banner",
    "-nostdin",
    ...(segment ? ["-ss", String(segment.startSeconds), "-t", String(segment.durationSeconds)] : []),
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-af",
    `${AUDIO_FILTER_CHAIN},loudnorm=I=${targetLufs}:LRA=${LOUDNESS_TARGET.range}:TP=${LOUDNESS_TARGET.truePeak}:print_format=json`,
    "-progress",
    "pipe:1",
    "-nostats",
    "-f",
    "null",
    nullTarget,
  ];
}

export function exportArguments(
  inputPath: string,
  partialOutputPath: string,
  measurements: LoudnormStats,
  targetLufs: number = LOUDNESS_TARGET.defaultIntegrated,
  segment?: { startSeconds: number; durationSeconds: number },
): string[] {
  if (!isValidLoudnessTarget(targetLufs)) throw new Error("Invalid loudness target.");
  const normalized = [
    `loudnorm=I=${targetLufs}`,
    `LRA=${LOUDNESS_TARGET.range}`,
    `TP=${LOUDNESS_TARGET.truePeak}`,
    `measured_I=${measurements.inputI}`,
    `measured_TP=${measurements.inputTp}`,
    `measured_LRA=${measurements.inputLra}`,
    `measured_thresh=${measurements.inputThresh}`,
    `offset=${measurements.targetOffset}`,
    "linear=true",
    "print_format=summary",
  ].join(":");

  return [
    "-hide_banner",
    "-nostdin",
    "-n",
    ...(segment ? ["-ss", String(segment.startSeconds), "-t", String(segment.durationSeconds)] : []),
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-map_metadata",
    "0",
    "-af",
    `${AUDIO_FILTER_CHAIN},${normalized}`,
    "-ar",
    "48000",
    "-ac",
    "1",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    "-id3v2_version",
    "3",
    "-metadata",
    "comment=Cleaned with Sermon Audio Cleaner",
    "-progress",
    "pipe:1",
    "-nostats",
    partialOutputPath,
  ];
}

export function parseProgressSeconds(line: string): number | null {
  const [key, rawValue] = line.trim().split("=", 2);
  if (key === "out_time_us" || key === "out_time_ms") {
    const microseconds = Number(rawValue);
    return Number.isFinite(microseconds) ? microseconds / 1_000_000 : null;
  }

  if (key === "out_time") {
    const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(rawValue ?? "");
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  return null;
}

export function progressPercent(
  processedSeconds: number,
  durationSeconds: number,
  startPercent: number,
  endPercent: number,
): number {
  if (durationSeconds <= 0) return startPercent;
  const ratio = Math.min(1, Math.max(0, processedSeconds / durationSeconds));
  return Math.round((startPercent + ratio * (endPercent - startPercent)) * 10) / 10;
}

export async function pathStats(filePath: string): Promise<Stats | null> {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}
