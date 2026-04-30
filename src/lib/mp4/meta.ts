// mvhd / mdhd / hdlr / trak collection — port of `mp4/meta.py`.
// (Pass 1 omits stco/co64/stsz/stsc — those are only used for GPMF samples.)

import type { RandomAccessFile } from "../randomAccessFile.ts";
import type { Atom, FourCC } from "./atoms.ts";
import { walk } from "./atoms.ts";

// Seconds between QuickTime epoch (1904-01-01 UTC) and Unix epoch.
export const QT_EPOCH_OFFSET = 2_082_844_800;

export interface MovieHeader {
  readonly creationUnix: number;
  readonly modificationUnix: number;
  readonly timescale: number;
  readonly duration: number;
  readonly durationSeconds: number;
}

function readUint64BE(view: DataView, offset: number): number {
  const hi = view.getUint32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  // Safe up to 2^53. mvhd timestamps and durations stay well below that.
  return hi * 0x1_0000_0000 + lo;
}

export async function parseMvhd(f: RandomAccessFile, atom: Atom): Promise<MovieHeader> {
  f.seek(atom.payloadOffset);
  const head = await f.readView(4);
  const version = head.getUint8(0); // flags discarded (next 3 bytes)
  let creation: number;
  let modification: number;
  let timescale: number;
  let duration: number;
  if (version === 1) {
    const view = await f.readView(28);
    creation = readUint64BE(view, 0);
    modification = readUint64BE(view, 8);
    timescale = view.getUint32(16, false);
    duration = readUint64BE(view, 20);
  } else {
    const view = await f.readView(16);
    creation = view.getUint32(0, false);
    modification = view.getUint32(4, false);
    timescale = view.getUint32(8, false);
    duration = view.getUint32(12, false);
  }
  return {
    creationUnix: creation - QT_EPOCH_OFFSET,
    modificationUnix: modification - QT_EPOCH_OFFSET,
    timescale,
    duration,
    durationSeconds: timescale ? duration / timescale : 0,
  };
}

// mdhd shares the leading layout with mvhd through `duration`.
export const parseMdhd = parseMvhd;

export async function parseHdlrType(f: RandomAccessFile, atom: Atom): Promise<FourCC> {
  // skip version+flags(4) + pre_defined(4) → handler_type at +8.
  f.seek(atom.payloadOffset + 8);
  const view = await f.readView(4);
  let s = "";
  for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(i));
  return s;
}

export async function parseStsdFirstFormat(f: RandomAccessFile, atom: Atom): Promise<FourCC> {
  // skip version+flags(4)
  f.seek(atom.payloadOffset + 4);
  const head = await f.readView(4);
  const entryCount = head.getUint32(0, false);
  if (entryCount === 0) return "";
  // Each entry: 4 bytes size + 4 bytes format + ...
  await f.read(4); // entry size
  const fmt = await f.readView(4);
  let s = "";
  for (let i = 0; i < 4; i++) s += String.fromCharCode(fmt.getUint8(i));
  return s;
}

export interface TrackInfo {
  readonly trakAtom: Atom;
  readonly handlerType: FourCC;
  readonly sampleFormat: FourCC;
  readonly mdhd: MovieHeader | null;
}

export async function collectTracks(f: RandomAccessFile, moov: Atom): Promise<TrackInfo[]> {
  const tracks: TrackInfo[] = [];
  for await (const trak of walk(f, moov.payloadOffset, moov.end)) {
    if (trak.fourcc !== "trak" || trak.depth !== 0) continue;
    let handler = "";
    let sampleFormat = "";
    let mdhd: MovieHeader | null = null;

    for await (const child of walk(f, trak.payloadOffset, trak.end)) {
      if (child.fourcc === "hdlr") {
        handler = await parseHdlrType(f, child);
      } else if (child.fourcc === "mdhd") {
        mdhd = await parseMdhd(f, child);
      } else if (child.fourcc === "stsd") {
        sampleFormat = await parseStsdFirstFormat(f, child);
      }
    }

    tracks.push({ trakAtom: trak, handlerType: handler, sampleFormat, mdhd });
  }
  return tracks;
}
