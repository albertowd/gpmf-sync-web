// Streaming MP4/QuickTime atom walker — port of `mp4/atoms.py`.
// Reads only atom headers; never loads payloads (mdat) into memory.

import type { RandomAccessFile } from "../randomAccessFile.ts";

const CONTAINER_ATOMS = new Set<string>([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "udta",
  "edts",
  "dinf",
]);

export type FourCC = string; // 4-char ASCII

export interface Atom {
  readonly fourcc: FourCC;
  readonly start: number;
  readonly size: number;
  readonly headerSize: number;
  readonly depth: number;
  readonly payloadOffset: number;
  readonly payloadSize: number;
  readonly end: number;
}

function makeAtom(
  fourcc: FourCC,
  start: number,
  size: number,
  headerSize: number,
  depth: number,
): Atom {
  return {
    fourcc,
    start,
    size,
    headerSize,
    depth,
    payloadOffset: start + headerSize,
    payloadSize: size - headerSize,
    end: start + size,
  };
}

function decodeFourCC(view: DataView, offset: number): FourCC {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
}

interface Header {
  size: number;
  fourcc: FourCC;
  headerSize: number;
}

async function readHeader(f: RandomAccessFile, end: number): Promise<Header | null> {
  const pos = f.tell();
  if (pos + 8 > end) return null;
  const head = await f.read(8);
  if (head.byteLength < 8) return null;
  const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const size32 = headView.getUint32(0, false);
  const fourcc = decodeFourCC(headView, 4);
  let size: number;
  let headerSize = 8;
  if (size32 === 1) {
    const ext = await f.read(8);
    if (ext.byteLength < 8) return null;
    const extView = new DataView(ext.buffer, ext.byteOffset, ext.byteLength);
    // 64-bit size: high32 << 32 | low32. Number stays exact below 2^53.
    const hi = extView.getUint32(0, false);
    const lo = extView.getUint32(4, false);
    size = hi * 0x1_0000_0000 + lo;
    headerSize = 16;
  } else if (size32 === 0) {
    // "extends to EOF" sentinel.
    size = end - pos;
  } else {
    size = size32;
  }
  return { size, fourcc, headerSize };
}

// Walks atoms in [start, end). Recurses into known container atoms.
// Yields each atom (including containers) before descending. The caller may
// seek freely between yields; the walker re-seeks before each sibling.
export async function* walk(
  f: RandomAccessFile,
  start = 0,
  end?: number,
  depth = 0,
): AsyncGenerator<Atom> {
  const fileEnd = end ?? f.size;

  let cursor = start;
  while (cursor < fileEnd) {
    f.seek(cursor);
    const header = await readHeader(f, fileEnd);
    if (header === null) break;
    const { size, fourcc, headerSize } = header;
    if (size < headerSize || cursor + size > fileEnd) break;

    const atom = makeAtom(fourcc, cursor, size, headerSize, depth);
    yield atom;

    if (CONTAINER_ATOMS.has(fourcc)) {
      yield* walk(f, atom.payloadOffset, atom.end, depth + 1);
    }

    cursor = atom.end;
  }
}

export async function findFirst(
  f: RandomAccessFile,
  fourcc: FourCC,
  start = 0,
  end?: number,
): Promise<Atom | null> {
  for await (const atom of walk(f, start, end)) {
    if (atom.fourcc === fourcc) return atom;
  }
  return null;
}

export async function findAll(
  f: RandomAccessFile,
  fourcc: FourCC,
  start = 0,
  end?: number,
): Promise<Atom[]> {
  const out: Atom[] = [];
  for await (const atom of walk(f, start, end)) {
    if (atom.fourcc === fourcc) out.push(atom);
  }
  return out;
}
