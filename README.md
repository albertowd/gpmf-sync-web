# gpmf-sync-web

Browser-side GoPro MP4 timestamp extractor — a TypeScript port of
[`gpmf-sync`](https://github.com/albertowd/gpmf-sync) that runs entirely
in the browser. Files never leave your machine.

The streaming MP4 atom parser only reads the bytes it needs (a few KB of
the `moov` box, plus camera metadata in `udta`), so a 10 GB GoPro `.MP4`
is handled without uploading or buffering it.

## Status

Feature parity with the parent CLI's `sync` command:

- MP4 timestamp sources: `gps` (first GPMF GPSU with fix), `mvhd`,
  `mdhd`, `cdat` (udta/GPMF). When GoPro's local-time-as-UTC firmware
  quirk makes sources disagree, the alternatives are surfaced so you
  can pick the matching timezone.
- TCX (Garmin) and RaceChrono v3 CSV first-timestamp readers.
- Cross-format alignment: chooses a reference (first MP4 with a
  timestamp), then computes a signed delta and trim/offset/aligned
  action per file.

Files never leave the browser — TCX/CSV are streamed line-by-line with
`ReadableStream` + `TextDecoderStream` and short-circuited on the first
match; MP4 reads use `Blob.slice().arrayBuffer()` so only the requested
byte ranges hit memory.

## Develop

```sh
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`).

## Quality gates

| Command | What it does |
| --- | --- |
| `npm run lint` | Biome — formatting + lint |
| `npm run format` | Biome — write formatting fixes |
| `npm run typecheck` | TypeScript project-references typecheck |
| `npm run build` | typecheck + production bundle (`dist/`) |
| `npm run preview` | Serve the built bundle locally |
| `npm run ci` | `lint && typecheck && build` (matches CI) |

## Layout

- `src/lib/randomAccessFile.ts` — `BinaryIO`-shaped wrapper around a
  browser `File`/`Blob`. Reads byte ranges via `Blob.slice().arrayBuffer()`,
  so only the requested bytes hit memory.
- `src/lib/mp4/atoms.ts` — streaming atom walker (port of `mp4/atoms.py`).
- `src/lib/mp4/meta.ts` — `mvhd` / `mdhd` / `hdlr` / `stsd` / sample-table
  (`stco`/`co64`/`stsz`/`stsc`) parsing.
- `src/lib/mp4/gpmf.ts` — GPMF KLV parser (port of `mp4/gpmf.py`).
- `src/lib/mp4/gpmfTrack.ts` — resolves GPMF samples to file offsets
  using the sample-table atoms.
- `src/lib/mp4/timestamps.ts` — high-level timestamp extraction
  (gps / mvhd / mdhd / cdat) and `udta` camera info.
- `src/lib/external/tcx.ts`, `rcCsv.ts`, `lineStream.ts` — TCX +
  RaceChrono CSV first-timestamp readers, streamed line-by-line.
- `src/lib/sync.ts` — cross-format `SyncReport` builder.
- `src/components/` — React UI mirroring the tkinter layout from
  `gpmf-sync/src/gmpf_sync/gui.py`.

## License

[GNU Affero General Public License v3.0 or later](LICENSE) — same as the
parent `gpmf-sync` project.
