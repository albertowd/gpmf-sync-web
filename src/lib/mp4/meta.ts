// mvhd / mdhd / hdlr / stsd / stco / co64 / stsz / stsc — port of `mp4/meta.py`.

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

export async function parseStco(f: RandomAccessFile, atom: Atom): Promise<number[]> {
  f.seek(atom.payloadOffset + 4);
  const head = await f.readView(4);
  const count = head.getUint32(0, false);
  if (count === 0) return [];
  const view = await f.readView(count * 4);
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = view.getUint32(i * 4, false);
  return out;
}

export async function parseCo64(f: RandomAccessFile, atom: Atom): Promise<number[]> {
  f.seek(atom.payloadOffset + 4);
  const head = await f.readView(4);
  const count = head.getUint32(0, false);
  if (count === 0) return [];
  const view = await f.readView(count * 8);
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const hi = view.getUint32(i * 8, false);
    const lo = view.getUint32(i * 8 + 4, false);
    out[i] = hi * 0x1_0000_0000 + lo;
  }
  return out;
}

export interface StszResult {
  readonly uniformSize: number; // non-zero ⇒ all samples share this size
  readonly sizes: number[]; // populated only when uniformSize === 0
}

export async function parseStsz(f: RandomAccessFile, atom: Atom): Promise<StszResult> {
  f.seek(atom.payloadOffset + 4);
  const head = await f.readView(8);
  const sampleSize = head.getUint32(0, false);
  const sampleCount = head.getUint32(4, false);
  if (sampleSize !== 0) return { uniformSize: sampleSize, sizes: [] };
  if (sampleCount === 0) return { uniformSize: 0, sizes: [] };
  const view = await f.readView(sampleCount * 4);
  const sizes = new Array<number>(sampleCount);
  for (let i = 0; i < sampleCount; i++) sizes[i] = view.getUint32(i * 4, false);
  return { uniformSize: 0, sizes };
}

export interface StscEntry {
  readonly firstChunk: number;
  readonly samplesPerChunk: number;
  readonly sampleDescriptionIndex: number;
}

export async function parseStsc(f: RandomAccessFile, atom: Atom): Promise<StscEntry[]> {
  f.seek(atom.payloadOffset + 4);
  const head = await f.readView(4);
  const count = head.getUint32(0, false);
  if (count === 0) return [];
  const view = await f.readView(count * 12);
  const out = new Array<StscEntry>(count);
  for (let i = 0; i < count; i++) {
    out[i] = {
      firstChunk: view.getUint32(i * 12, false),
      samplesPerChunk: view.getUint32(i * 12 + 4, false),
      sampleDescriptionIndex: view.getUint32(i * 12 + 8, false),
    };
  }
  return out;
}

export interface TrackInfo {
  readonly trakAtom: Atom;
  readonly handlerType: FourCC;
  readonly sampleFormat: FourCC;
  readonly mdhd: MovieHeader | null;
  readonly stcoAtom: Atom | null;
  readonly co64Atom: Atom | null;
  readonly stszAtom: Atom | null;
  readonly stscAtom: Atom | null;
}

export async function collectTracks(f: RandomAccessFile, moov: Atom): Promise<TrackInfo[]> {
  const tracks: TrackInfo[] = [];
  for await (const trak of walk(f, moov.payloadOffset, moov.end)) {
    if (trak.fourcc !== "trak" || trak.depth !== 0) continue;
    let handler = "";
    let sampleFormat = "";
    let mdhd: MovieHeader | null = null;
    let stcoAtom: Atom | null = null;
    let co64Atom: Atom | null = null;
    let stszAtom: Atom | null = null;
    let stscAtom: Atom | null = null;

    for await (const child of walk(f, trak.payloadOffset, trak.end)) {
      switch (child.fourcc) {
        case "hdlr":
          handler = await parseHdlrType(f, child);
          break;
        case "mdhd":
          mdhd = await parseMdhd(f, child);
          break;
        case "stsd":
          sampleFormat = await parseStsdFirstFormat(f, child);
          break;
        case "stco":
          stcoAtom = child;
          break;
        case "co64":
          co64Atom = child;
          break;
        case "stsz":
          stszAtom = child;
          break;
        case "stsc":
          stscAtom = child;
          break;
        default:
          break;
      }
    }

    tracks.push({
      trakAtom: trak,
      handlerType: handler,
      sampleFormat,
      mdhd,
      stcoAtom,
      co64Atom,
      stszAtom,
      stscAtom,
    });
  }
  return tracks;
}
