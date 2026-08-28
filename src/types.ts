export const MAX_DURATION_SECONDS = 90 * 60;

export type JobState =
  | "idle"
  | "validating"
  | "analyzing"
  | "exporting"
  | "completed"
  | "failed"
  | "cancelled";

export type ProcessingErrorCode =
  | "BUSY"
  | "FILE_NOT_FOUND"
  | "UNSUPPORTED_FORMAT"
  | "INVALID_AUDIO"
  | "DURATION_LIMIT"
  | "INSUFFICIENT_DISK"
  | "WRITE_FAILED"
  | "PROCESSOR_MISSING"
  | "PREVIEW_FAILED"
  | "INVALID_TARGET"
  | "PROCESSING_FAILED"
  | "CANCELLED";

export interface AudioSelection {
  sourcePath: string;
  name: string;
  sizeBytes: number;
}

export interface AudioFileInfo extends AudioSelection {
  durationSeconds: number;
  codec: string;
  sampleRate: number | null;
  channels: number | null;
}

export interface AudioPreview {
  previewId: string;
  file: AudioFileInfo;
  audioUrl: string;
  sampleStartSeconds: number;
  sampleDurationSeconds: number;
  referenceLufs: number;
}

export interface JobStart {
  jobId: string;
}

export interface ProcessingProgress {
  jobId: string;
  state: Exclude<JobState, "idle" | "completed" | "failed" | "cancelled">;
  percent: number;
  elapsedSeconds: number;
  processedSeconds: number;
  durationSeconds: number;
  message: string;
  file?: AudioFileInfo;
}

export interface ProcessingResult {
  jobId: string;
  state: "completed";
  outputPath: string;
  outputName: string;
  audioUrl: string;
  durationSeconds: number;
  sizeBytes: number;
  targetLufs: number;
}

interface ProcessingFailureBase {
  jobId: string;
  code: ProcessingErrorCode;
  message: string;
}

export type ProcessingFailure = ProcessingFailureBase &
  ({ state: "failed" } | { state: "cancelled" });

export type JobEvent = ProcessingProgress | ProcessingResult | ProcessingFailure;

export interface SermonCleanerApi {
  selectAudio: () => Promise<AudioSelection | null>;
  registerDroppedFile: (file: File) => Promise<AudioSelection>;
  preparePreview: (sourcePath: string) => Promise<AudioPreview>;
  discardPreview: (previewId: string) => Promise<void>;
  startProcessing: (previewId: string, targetLufs: number) => Promise<JobStart>;
  cancelProcessing: (jobId: string) => Promise<void>;
  openOutput: (jobId: string) => Promise<void>;
  revealOutput: (jobId: string) => Promise<void>;
  onJobEvent: (listener: (event: JobEvent) => void) => () => void;
}
