# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-04-30

### Added
- Pure-JS port of the `gpmf-sync` parser stack, running entirely in the
  browser — files never leave the user's machine.
- Streaming MP4 atom walker over `Blob.slice().arrayBuffer()` so only the
  byte ranges actually needed (`moov`, `udta`, sample-table entries) are
  read; multi-GB GoPro clips are handled without buffering.
- Four timestamp sources resolved in priority order: GPMF `GPSU`/`GPSF`,
  `mvhd`, per-track `mdhd`, and `udta/GPMF/CDAT`, with disagreeing
  sources surfaced so the GoPro local-time-as-UTC firmware quirk is
  visible to the user.
- TCX (Garmin) and RaceChrono v3 CSV first-timestamp readers, streamed
  line-by-line with `ReadableStream` + `TextDecoderStream` and
  short-circuited on the first match.
- Cross-format `SyncReport` builder that picks a reference MP4 and
  computes signed delta + trim/offset/aligned action per file.
- React UI mirroring the tkinter layout from the parent project's
  `gui.py`, including drag-and-drop file intake.
- Vite + TypeScript project-references build, Biome formatting/lint, and
  an `npm run ci` gate (`lint && typecheck && build`) matching CI.
- Lighthouse-oriented polish: preview asset, generated favicons/icons,
  and metadata for social previews.

[Unreleased]: https://github.com/albertowd/gpmf-sync-web/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/albertowd/gpmf-sync-web/releases/tag/v1.0.0
