// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { JobEvent, SermonCleanerApi } from "../src/types";

let eventListener: ((event: JobEvent) => void) | null = null;
let api: SermonCleanerApi;

beforeEach(() => {
  eventListener = null;
  api = {
    selectAudio: vi.fn().mockResolvedValue({
      sourcePath: "C:\\Sermons\\Sunday.wav",
      name: "Sunday.wav",
      sizeBytes: 12_000_000,
    }),
    registerDroppedFile: vi.fn(),
    preparePreview: vi.fn().mockResolvedValue({
      previewId: "preview-1",
      file: {
        sourcePath: "C:\\Sermons\\Sunday.wav",
        name: "Sunday.wav",
        sizeBytes: 12_000_000,
        durationSeconds: 1800,
        codec: "pcm_s16le",
        sampleRate: 48_000,
        channels: 2,
      },
      audioUrl: "sermon-audio://preview/preview-1",
      sampleStartSeconds: 898.5,
      sampleDurationSeconds: 3,
      referenceLufs: -14,
    }),
    discardPreview: vi.fn(),
    startProcessing: vi.fn().mockResolvedValue({ jobId: "job-1" }),
    cancelProcessing: vi.fn(),
    openOutput: vi.fn(),
    revealOutput: vi.fn(),
    onJobEvent: vi.fn((listener) => {
      eventListener = listener;
      return () => undefined;
    }),
  };
  window.sermonCleaner = api;
});

describe("Sermon Audio Cleaner interface", () => {
  it("prepares a preview and waits for confirmation before cleaning", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /choose recording/i }));
    await waitFor(() => expect(api.preparePreview).toHaveBeenCalledWith("C:\\Sermons\\Sunday.wav"));
    expect(api.startProcessing).not.toHaveBeenCalled();
    expect(screen.getByText("Sunday.wav")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /output volume/i })).toHaveValue("-16");
    await userEvent.click(screen.getByRole("button", { name: /clean full recording/i }));
    await waitFor(() => expect(api.startProcessing).toHaveBeenCalledWith("preview-1", -16));
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("updates preview gain and passes a quieter target", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /choose recording/i }));
    const slider = await screen.findByRole("slider", { name: /output volume/i });
    const audio = document.querySelector("audio") as HTMLAudioElement;
    expect(audio.volume).toBeCloseTo(0.794, 2);

    fireEvent.change(slider, { target: { value: "-22" } });
    expect(slider).toHaveValue("-22");
    expect(audio.volume).toBeCloseTo(0.398, 2);
    await userEvent.click(screen.getByRole("button", { name: /clean full recording/i }));
    await waitFor(() => expect(api.startProcessing).toHaveBeenCalledWith("preview-1", -22));
  });

  it("shows playback and file actions when processing completes", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /choose recording/i }));
    await screen.findByRole("slider", { name: /output volume/i });
    await userEvent.click(screen.getByRole("button", { name: /clean full recording/i }));
    await waitFor(() => expect(api.startProcessing).toHaveBeenCalled());

    act(() => {
      eventListener?.({
        jobId: "job-1",
        state: "completed",
        outputPath: "C:\\Sermons\\Sunday-cleaned.mp3",
        outputName: "Sunday-cleaned.mp3",
        audioUrl: "sermon-audio://result/job-1",
        durationSeconds: 1800,
        sizeBytes: 30_000_000,
        targetLufs: -16,
      });
    });

    expect(await screen.findByText("Your sermon is ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open cleaned mp3/i })).toBeInTheDocument();
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("sermon-audio://result/job-1");
  });
});
