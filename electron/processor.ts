import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  rename,
  rm,
  stat,
  statfs,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AudioFileInfo,
  AudioSelection,
  JobEvent,
  JobStart,
  ProcessingErrorCode,
  ProcessingResult,
} from "../src/types";
import { MAX_DURATION_SECONDS } from "../src/types";
import {
  analysisArguments,
  exportArguments,
  findAvailableOutputPath,
  isSupportedAudioPath,
  parseLoudnormStats,
  parseProgressSeconds,
  pathStats,
  progressPercent,
} from "./audio-utils";

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
  };
}

interface JobRecord {
  id: string;
  sourcePath: string;
  startedAt: number;
  cancelRequested: boolean;
  child: ChildProcess | null;
  partialPath: string | null;
  result: ProcessingResult | null;
}

interface RunResult {
  stdout: string;
  stderr: string;
}

interface ProcessorOptions {
  ffmpegPath: string;
  ffprobePath: string;
  downloadsDirectory: string;
  emit: (event: JobEvent) => void;
}

export class ProcessingError extends Error {
  constructor(
    public readonly code: ProcessingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProcessingError";
  }
}

export class AudioProcessor {
  private readonly jobs = new Map<string, JobRecord>();
  private activeJobId: string | null = null;

  constructor(private readonly options: ProcessorOptions) {}

  async selectionFor(sourcePath: string): Promise<AudioSelection> {
    if (!isSupportedAudioPath(sourcePath)) {
      throw new ProcessingError(
        "UNSUPPORTED_FORMAT",
        "Choose an MP3, WAV, M4A, AAC, FLAC, OGG, Opus, or WebM audio file.",
      );
    }

    const file = await pathStats(sourcePath);
    if (!file?.isFile()) {
      throw new ProcessingError("FILE_NOT_FOUND", "That audio file could not be found.");
    }

    return {
      sourcePath,
      name: path.basename(sourcePath),
      sizeBytes: file.size,
    };
  }

  start(sourcePath: string): JobStart {
    if (this.activeJobId) {
      throw new ProcessingError("BUSY", "Finish or cancel the current sermon first.");
    }

    const id = randomUUID();
    const job: JobRecord = {
      id,
      sourcePath,
      startedAt: Date.now(),
      cancelRequested: false,
      child: null,
      partialPath: null,
      result: null,
    };
    this.jobs.set(id, job);
    this.activeJobId = id;
    void this.process(job);
    return { jobId: id };
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.result) return;
    job.cancelRequested = true;
    job.child?.kill("SIGTERM");
  }

  resultFor(jobId: string): ProcessingResult | null {
    return this.jobs.get(jobId)?.result ?? null;
  }

  async dispose(): Promise<void> {
    const active = this.activeJobId ? this.jobs.get(this.activeJobId) : null;
    if (!active) return;
    active.cancelRequested = true;
    active.child?.kill("SIGTERM");
    await this.removePartial(active);
  }

  private async process(job: JobRecord): Promise<void> {
    try {
      const selection = await this.selectionFor(job.sourcePath);
      this.emitProgress(job, "validating", 1, 0, 0, "Checking the recording…");
      const file = await this.probeInput(job, selection);
      this.throwIfCancelled(job);

      const outputDirectory = await this.chooseOutputDirectory(job.sourcePath);
      await this.assertEnoughDiskSpace(outputDirectory, file.durationSeconds);
      let outputPath = await findAvailableOutputPath(job.sourcePath, outputDirectory);
      job.partialPath = path.join(
        outputDirectory,
        `.${path.parse(outputPath).name}.${job.id}.partial.mp3`,
      );

      this.emitProgress(
        job,
        "analyzing",
        5,
        0,
        file.durationSeconds,
        "Cleaning noise and measuring loudness…",
        file,
      );
      const analysis = await this.run(
        job,
        this.options.ffmpegPath,
        analysisArguments(job.sourcePath, process.platform === "win32" ? "NUL" : "/dev/null"),
        (line) => {
          const seconds = parseProgressSeconds(line);
          if (seconds === null) return;
          this.emitProgress(
            job,
            "analyzing",
            progressPercent(seconds, file.durationSeconds, 5, 50),
            seconds,
            file.durationSeconds,
            "Cleaning noise and measuring loudness…",
            file,
          );
        },
      );
      const measurements = parseLoudnormStats(analysis.stderr);
      this.throwIfCancelled(job);

      this.emitProgress(
        job,
        "exporting",
        50,
        0,
        file.durationSeconds,
        "Leveling and creating the cleaned MP3…",
        file,
      );
      await this.run(
        job,
        this.options.ffmpegPath,
        exportArguments(job.sourcePath, job.partialPath, measurements),
        (line) => {
          const seconds = parseProgressSeconds(line);
          if (seconds === null) return;
          this.emitProgress(
            job,
            "exporting",
            progressPercent(seconds, file.durationSeconds, 50, 96),
            seconds,
            file.durationSeconds,
            "Leveling and creating the cleaned MP3…",
            file,
          );
        },
      );
      this.throwIfCancelled(job);

      this.emitProgress(
        job,
        "exporting",
        97,
        file.durationSeconds,
        file.durationSeconds,
        "Verifying the finished recording…",
        file,
      );
      await this.verifyOutput(job, job.partialPath, file.durationSeconds);

      if (await pathStats(outputPath)) {
        outputPath = await findAvailableOutputPath(job.sourcePath, outputDirectory);
      }
      try {
        await rename(job.partialPath, outputPath);
      } catch {
        throw new ProcessingError(
          "WRITE_FAILED",
          "The cleaned recording could not be saved. Check the destination folder and free space.",
        );
      }
      job.partialPath = null;

      const output = await stat(outputPath);
      job.result = {
        jobId: job.id,
        state: "completed",
        outputPath,
        outputName: path.basename(outputPath),
        audioUrl: `sermon-audio://result/${job.id}`,
        durationSeconds: file.durationSeconds,
        sizeBytes: output.size,
      };
      this.options.emit(job.result);
    } catch (error) {
      await this.removePartial(job);
      const failure = this.toFailure(error, job.cancelRequested);
      this.options.emit({
        jobId: job.id,
        state: failure.code === "CANCELLED" ? "cancelled" : "failed",
        code: failure.code,
        message: failure.message,
      });
    } finally {
      job.child = null;
      if (this.activeJobId === job.id) this.activeJobId = null;
    }
  }

  private async probeInput(job: JobRecord, selection: AudioSelection): Promise<AudioFileInfo> {
    const result = await this.run(job, this.options.ffprobePath, [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      job.sourcePath,
    ]);

    let probe: ProbeOutput;
    try {
      probe = JSON.parse(result.stdout) as ProbeOutput;
    } catch {
      throw new ProcessingError("INVALID_AUDIO", "The recording is corrupt or cannot be read.");
    }

    const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
    const durationSeconds = Number(audio?.duration ?? probe.format?.duration);
    if (!audio || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new ProcessingError("INVALID_AUDIO", "The selected file does not contain readable audio.");
    }
    if (durationSeconds > MAX_DURATION_SECONDS + 0.05) {
      throw new ProcessingError(
        "DURATION_LIMIT",
        "Version 1 supports recordings up to 90 minutes long.",
      );
    }

    return {
      ...selection,
      durationSeconds,
      codec: audio.codec_name ?? "unknown",
      sampleRate: audio.sample_rate ? Number(audio.sample_rate) : null,
      channels: audio.channels ?? null,
    };
  }

  private async verifyOutput(
    job: JobRecord,
    outputPath: string,
    sourceDuration: number,
  ): Promise<void> {
    const result = await this.run(job, this.options.ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,sample_rate,channels,duration:format=duration",
      "-of",
      "json",
      outputPath,
    ]);

    try {
      const probe = JSON.parse(result.stdout) as ProbeOutput;
      const stream = probe.streams?.[0];
      const duration = Number(stream?.duration ?? probe.format?.duration);
      if (
        stream?.codec_name !== "mp3" ||
        Number(stream.sample_rate) !== 48_000 ||
        stream.channels !== 1 ||
        !Number.isFinite(duration) ||
        Math.abs(duration - sourceDuration) > 2
      ) {
        throw new Error("Output properties did not match the requested format.");
      }
    } catch {
      throw new ProcessingError(
        "PROCESSING_FAILED",
        "The processor did not create a valid cleaned MP3. The original was not changed.",
      );
    }
  }

  private async chooseOutputDirectory(sourcePath: string): Promise<string> {
    const sourceDirectory = path.dirname(sourcePath);
    try {
      await access(sourceDirectory, fsConstants.W_OK);
      return sourceDirectory;
    } catch {
      await mkdir(this.options.downloadsDirectory, { recursive: true });
      try {
        await access(this.options.downloadsDirectory, fsConstants.W_OK);
        return this.options.downloadsDirectory;
      } catch {
        throw new ProcessingError(
          "WRITE_FAILED",
          "Neither the recording folder nor Downloads is writable.",
        );
      }
    }
  }

  private async assertEnoughDiskSpace(directory: string, durationSeconds: number): Promise<void> {
    try {
      const disk = await statfs(directory);
      const available = Number(disk.bavail) * Number(disk.bsize);
      const expectedMp3Bytes = durationSeconds * 16_000;
      const safetyMargin = 100 * 1024 * 1024;
      if (available < expectedMp3Bytes + safetyMargin) {
        throw new ProcessingError(
          "INSUFFICIENT_DISK",
          "There is not enough free space to safely create the cleaned recording.",
        );
      }
    } catch (error) {
      if (error instanceof ProcessingError) throw error;
      // Some filesystems do not expose free-space statistics. FFmpeg will still
      // report a write failure without risking the source file.
    }
  }

  private run(
    job: JobRecord,
    executable: string,
    args: string[],
    onStdoutLine?: (line: string) => void,
  ): Promise<RunResult> {
    this.throwIfCancelled(job);

    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      job.child = child;

      let stdout = "";
      let stderr = "";
      let lineBuffer = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.length > 8 * 1024 * 1024) stdout = stdout.slice(-8 * 1024 * 1024);
        if (!onStdoutLine) return;
        lineBuffer += chunk;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) onStdoutLine(line);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        if (stderr.length > 8 * 1024 * 1024) stderr = stderr.slice(-8 * 1024 * 1024);
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        job.child = null;
        if (error.code === "ENOENT") {
          reject(
            new ProcessingError(
              "PROCESSOR_MISSING",
              "The bundled audio processor could not be found. Reinstall the application.",
            ),
          );
          return;
        }
        reject(error);
      });
      child.on("close", (code) => {
        job.child = null;
        if (job.cancelRequested) {
          reject(new ProcessingError("CANCELLED", "Processing was cancelled."));
          return;
        }
        if (code !== 0) {
          const diagnostic = stderr.trim().split(/\r?\n/).slice(-4).join("\n");
          console.error(`Audio processor exited with code ${code}:\n${diagnostic}`);
          reject(
            new ProcessingError(
              "PROCESSING_FAILED",
              "This recording could not be processed. The original file was not changed.",
            ),
          );
          return;
        }
        if (lineBuffer && onStdoutLine) onStdoutLine(lineBuffer);
        resolve({ stdout, stderr });
      });
    });
  }

  private emitProgress(
    job: JobRecord,
    state: "validating" | "analyzing" | "exporting",
    percent: number,
    processedSeconds: number,
    durationSeconds: number,
    message: string,
    file?: AudioFileInfo,
  ): void {
    this.options.emit({
      jobId: job.id,
      state,
      percent,
      elapsedSeconds: (Date.now() - job.startedAt) / 1000,
      processedSeconds: Math.min(processedSeconds, durationSeconds),
      durationSeconds,
      message,
      file,
    });
  }

  private throwIfCancelled(job: JobRecord): void {
    if (job.cancelRequested) {
      throw new ProcessingError("CANCELLED", "Processing was cancelled.");
    }
  }

  private async removePartial(job: JobRecord): Promise<void> {
    if (!job.partialPath) return;
    await rm(job.partialPath, { force: true }).catch(() => undefined);
    job.partialPath = null;
  }

  private toFailure(
    error: unknown,
    cancelled: boolean,
  ): { code: ProcessingErrorCode; message: string } {
    if (cancelled) return { code: "CANCELLED", message: "Processing was cancelled." };
    if (error instanceof ProcessingError) {
      return { code: error.code, message: error.message };
    }
    console.error(error);
    return {
      code: "PROCESSING_FAILED",
      message: "An unexpected audio processing error occurred. The original file was not changed.",
    };
  }
}
