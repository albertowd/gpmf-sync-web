// Resolve GPMF samples within an MP4 file: file-offset and size of each
// KLV payload — port of `mp4/gpmf_track.py`.

import type { RandomAccessFile } from "../randomAccessFile.ts";
import type { TrackInfo } from "./meta.ts";
import { parseCo64, parseStco, parseStsc, parseStsz } from "./meta.ts";

export interface SampleRef {
  readonly fileOffset: number;
  readonly size: number;
}

export async function readSample(f: RandomAccessFile, ref: SampleRef): Promise<Uint8Array> {
  f.seek(ref.fileOffset);
  return f.read(ref.size);
}

export async function* iterSampleRefs(
  f: RandomAccessFile,
  track: TrackInfo,
): AsyncGenerator<SampleRef> {
  let chunkOffsets: number[];
  if (track.stcoAtom !== null) {
    chunkOffsets = await parseStco(f, track.stcoAtom);
  } else if (track.co64Atom !== null) {
    chunkOffsets = await parseCo64(f, track.co64Atom);
  } else {
    return;
  }

  if (track.stszAtom === null) return;
  const { uniformSize, sizes } = await parseStsz(f, track.stszAtom);

  let stsc =
    track.stscAtom !== null
      ? await parseStsc(f, track.stscAtom)
      : [{ firstChunk: 1, samplesPerChunk: 1, sampleDescriptionIndex: 1 }];
  if (stsc.length === 0) {
    stsc = [{ firstChunk: 1, samplesPerChunk: 1, sampleDescriptionIndex: 1 }];
  }

  let sampleIdx = 0;
  const chunkCount = chunkOffsets.length;

  for (let runIdx = 0; runIdx < stsc.length; runIdx++) {
    const run = stsc[runIdx];
    if (!run) return;
    const nextFirstChunk =
      runIdx + 1 < stsc.length ? (stsc[runIdx + 1]?.firstChunk ?? chunkCount + 1) : chunkCount + 1;

    for (let chunk1 = run.firstChunk; chunk1 < nextFirstChunk; chunk1++) {
      const chunkIdx = chunk1 - 1;
      if (chunkIdx >= chunkCount) return;
      let offset = chunkOffsets[chunkIdx];
      if (offset === undefined) return;
      for (let s = 0; s < run.samplesPerChunk; s++) {
        let size: number;
        if (uniformSize !== 0) {
          size = uniformSize;
        } else {
          if (sampleIdx >= sizes.length) return;
          size = sizes[sampleIdx] ?? 0;
        }
        yield { fileOffset: offset, size };
        offset += size;
        sampleIdx += 1;
      }
    }
  }
}
