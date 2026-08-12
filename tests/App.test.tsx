// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
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
  it("selects one recording and starts automatically", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /choose recording/i }));
    await waitFor(() => expect(api.startProcessing).toHaveBeenCalledWith("C:\\Sermons\\Sunday.wav"));
    expect(screen.getByText("Sunday.wav")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("shows playback and file actions when processing completes", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /choose recording/i }));
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
      });
    });

    expect(await screen.findByText("Your sermon is ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open cleaned mp3/i })).toBeInTheDocument();
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("sermon-audio://result/job-1");
  });
});
