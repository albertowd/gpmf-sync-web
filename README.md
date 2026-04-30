# gpmf-sync-web

Browser-side GoPro MP4 timestamp extractor — a TypeScript port of
[`gpmf-sync`](https://github.com/albertowd/gpmf-sync) that runs entirely
in the browser. Files never leave your machine.

The streaming MP4 atom parser only reads the bytes it needs (a few KB of
the `moov` box, plus camera metadata in `udta`), so a 10 GB GoPro `.MP4`
is handled without uploading or buffering it.

## Status

Pass 1 (current): `mvhd` and `mdhd` timestamp paths, plus camera info
(`FIRM`, `CAME`, `LENS`).

Pass 2 (planned): GPMF GPSU/GPSF and `udta/GPMF/CDAT` timestamps; TCX +
RaceChrono v3 CSV alignment.

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
- `src/lib/mp4/meta.ts` — `mvhd` / `mdhd` / `hdlr` / `trak` parsing.
- `src/lib/mp4/timestamps.ts` — high-level timestamp extraction.
- `src/components/` — React UI mirroring the tkinter layout from
  `gpmf-sync/src/gmpf_sync/gui.py`.

## License

[GNU Affero General Public License v3.0 or later](LICENSE) — same as the
parent `gpmf-sync` project.
