import type { SermonCleanerApi } from "./types";

declare global {
  interface Window {
    sermonCleaner: SermonCleanerApi;
  }
}

export {};
