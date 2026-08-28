# Real-sermon validation — August 12, 2026

## Fixture

- Publisher: Carrollwood Bible Chapel
- Message: “The Nation of Israel's Past Election, Present Rejection, Future Restoration”
- Speaker/date: Mike Gentile, August 2, 2026
- Page: <https://www.biblechapel.com/messages/all/mike-gentile/the-nation-of-israels-past-election-present-rejection-future-restoration>
- Source SHA-256: `D20445C727D05DF2DD0997492385D44CEA2CBC06C824825ECBE9FDD561AABA7E`

The downloaded audio fixture and its cleaned output are intentionally ignored by Git because they are large third-party media files.

## End-to-end result

The packaged Windows application was launched with Playwright. Its native file dialog was directed to the downloaded fixture, the normal renderer button initiated processing, and the test waited for the application’s completion screen. Processing completed in 2 minutes 59 seconds. The test also confirmed that source size and modification time were unchanged and that the output existed with nontrivial size.

| Measurement | Source | Cleaned output | Result |
|---|---:|---:|---|
| Format | MP3 | MP3 | Pass |
| Sample rate | 48 kHz | 48 kHz | Pass |
| Channels | Stereo | Mono | Pass |
| Bit rate | 192 kbps | 128 kbps | Pass |
| Duration | 2656.416 s | 2656.440 s | Pass — 24 ms drift |
| File size | 63,754,415 bytes | 42,503,676 bytes | 33.3% smaller |
| Integrated loudness | −32.24 LUFS | −16.62 LUFS | Pass — within −16 ±1 LU |
| True peak | −7.40 dBFS | −1.12 dBFS | Pass — below −1 dBFS |
| Loudness range | 9.70 LU | 5.50 LU | Pass — 4.20 LU more consistent |
| Relative 9–15 kHz energy | −21.49 dB | −26.72 dB | 5.23 dB reduction |

- Output SHA-256: `601AD95E07CC27FD48B1FA95945281F69459E52A46E49AF46307BD4B20B61914`
- No `.partial.mp3` remained after completion.
- Full-file decoding and `astats` analysis reported no NaN, infinity, or denormal samples in the output.

## Interpretation

The structural, safety, loudness, duration, and deterministic-noise-reduction acceptance criteria pass. The high-frequency comparison is a denoising proxy: it measures the 9–15 kHz band relative to total program RMS so that the output’s loudness gain does not create a misleading comparison. It is consistent with reduced hiss, but it is not a clean-reference SNR or a substitute for human listening. Final subjective acceptance should include listening to speech, pauses, and consonants for metallic artifacts or pumping.

## Adjustable-volume validation — August 28, 2026

Version 0.2.0 prepared a three-second preview at 1326.708 seconds, centered within 8 ms of the 44:16 recording's midpoint. The packaged Windows app then used the slider-selected −20 LUFS target and completed the full recording in 7 minutes 36 seconds.

| Measurement | Selected target/output | Result |
|---|---:|---|
| Preview duration | 3.000 s | Pass |
| Preview reference level | −14 LUFS | Pass — supports instant slider attenuation |
| Selected full-file target | −20 LUFS | Pass |
| Measured integrated loudness | −20.45 LUFS | Pass — within −20 ±1 LU |
| Measured true peak | −1.63 dBFS | Pass — below −1.5 dBFS |
| Measured loudness range | 6.80 LU | Pass — below the 7 LU target |
| Output size | 42,503,676 bytes | Pass |

- Adjustable output SHA-256: `A31747CB4E13C45CEB663140A2FDF667706D6F7B3758CDBA82599659948BE50C`
- The source size and modification time were unchanged.
- The packaged interface displayed `Normalized to -20 LUFS` on completion.
