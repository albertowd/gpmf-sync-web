// GPMF (GoPro Metadata Format) KLV parser — port of `mp4/gpmf.py`.
//
// Spec: GPMF is a 32-bit-aligned Key-Length-Value stream. Each entry is:
//     4 bytes: FourCC key
//     1 byte:  type char (ASCII; 0x00 means "nested container")
//     1 byte:  struct size (bytes per sample)
//     2 bytes: repeat count (big-endian)
//     N bytes: data, where N = struct_size * repeat, padded to 4-byte alignment.

export interface GpmfEntry {
  readonly key: string; // 4-char ASCII
  readonly typeChar: number; // 0 means nested container
  readonly structSize: number;
  readonly repeat: number;
  readonly payload: Uint8Array; // raw, big-endian, unpadded
}

export function isNested(entry: GpmfEntry): boolean {
  return entry.typeChar === 0;
}

function decodeFourCC(data: Uint8Array, offset: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += String.fromCharCode(data[offset + i] ?? 0);
  }
  return s;
}

export function* iterEntries(data: Uint8Array, offset = 0, end?: number): Generator<GpmfEntry> {
  const stop = end ?? data.byteLength;
  // Backing-buffer-aware view: `data` may be a slice of a larger buffer.
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let i = offset;
  while (i + 8 <= stop) {
    const key = decodeFourCC(data, i);
    const typeChar = data[i + 4] ?? 0;
    const structSize = data[i + 5] ?? 0;
    const repeat = view.getUint16(i + 6, false);
    const n = structSize * repeat;
    if (i + 8 + n > stop) return;
    const payload = data.subarray(i + 8, i + 8 + n);
    yield { key, typeChar, structSize, repeat, payload };
    i += 8 + ((n + 3) & ~3);
  }
}

export function findRecursive(data: Uint8Array, target: string): GpmfEntry | null {
  for (const entry of iterEntries(data)) {
    if (entry.key === target) return entry;
    if (isNested(entry)) {
      const found = findRecursive(entry.payload, target);
      if (found !== null) return found;
    }
  }
  return null;
}

export function findAllRecursive(data: Uint8Array, target: string): GpmfEntry[] {
  const out: GpmfEntry[] = [];
  for (const entry of iterEntries(data)) {
    if (entry.key === target) out.push(entry);
    if (isNested(entry)) out.push(...findAllRecursive(entry.payload, target));
  }
  return out;
}
