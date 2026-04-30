// High-level timestamp extraction for GoPro MP4 files.
// Port of `mp4/timestamps.py`. Sources: gps (GPMF GPSU/GPSF), mvhd, mdhd, cdat.

import type { RandomAccessFile } from "../randomAccessFile.ts";
import type { Atom } from "./atoms.ts";
import { findFirst, walk } from "./atoms.ts";
import { findRecursive } from "./gpmf.ts";
import { iterSampleRefs, readSample } from "./gpmfTrack.ts";
import type { TrackInfo } from "./meta.ts";
import { collectTracks, parseMvhd } from "./meta.ts";

export type SourceName = "gps" | "mvhd" | "mdhd" | "cdat";

export const DEFAULT_AUTO_ORDER: readonly SourceName[] = ["gps", "mvhd", "mdhd", "cdat"] as const;

// How many GPMF samples to scan before giving up on finding a GPS fix.
const MAX_GPS_SCAN_SAMPLES = 32;
const NUL_CHAR = String.fromCharCode(0);

export interface StampSource {
  readonly name: SourceName;
  readonly epoch: number | null;
  readonly iso: string | null;
  readonly detail: Record<string, string | number | boolean>;
}

export type CameraTag = "FIRM" | "CAME" | "LENS";
export type CameraInfo = Partial<Record<CameraTag, string>>;

export interface TimestampReport {
  readonly file: string;
  readonly fileSize: number;
  readonly sources: Partial<Record<SourceName, StampSource>>;
  readonly selectedSource: SourceName | null;
  readonly selectedEpoch: number | null;
  readonly selectedIso: string | null;
  readonly camera: CameraInfo;
}

function epochToIso(epoch: number | null): string | null {
  if (epoch === null) return null;
  return new Date(epoch * 1000).toISOString().replace(".000Z", "Z");
}

function missingSource(name: SourceName, reason: string): StampSource {
  return { name, epoch: null, iso: null, detail: { missing: reason } };
}

async function extractMvhd(f: RandomAccessFile, moov: Atom): Promise<StampSource> {
  const mvhdAtom = await findFirst(f, "mvhd", moov.payloadOffset, moov.end);
  if (mvhdAtom === null) return missingSource("mvhd", "atom not found");
  const mvhd = await parseMvhd(f, mvhdAtom);
  return {
    name: "mvhd",
    epoch: mvhd.creationUnix,
    iso: epochToIso(mvhd.creationUnix),
    detail: {
      modification_unix: mvhd.modificationUnix,
      duration_seconds: mvhd.durationSeconds,
      warning: "may be local time without TZ marker on some GoPro firmware",
    },
  };
}

function extractMdhd(tracks: readonly TrackInfo[]): StampSource {
  const vide = tracks.find((t) => t.handlerType === "vide" && t.mdhd !== null);
  if (!vide?.mdhd) return missingSource("mdhd", "no video track with mdhd");
  return {
    name: "mdhd",
    epoch: vide.mdhd.creationUnix,
    iso: epochToIso(vide.mdhd.creationUnix),
    detail: { track: "video", duration_seconds: vide.mdhd.durationSeconds },
  };
}

// GPSU is ASCII 'yymmddhhmmss.sss' (16 bytes), UTC.
function parseGpsu(raw: Uint8Array): number | null {
  const trimmedLen = Math.min(raw.length, 16);
  let s = "";
  for (let i = 0; i < trimmedLen; i++) {
    const b = raw[i] ?? 0;
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  s = s.trim();
  if (s.length < 12) return null;
  const yy = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const dd = Number(s.slice(4, 6));
  const hh = Number(s.slice(6, 8));
  const mi = Number(s.slice(8, 10));
  const ss = Number(s.slice(10, 12));
  if (![yy, mm, dd, hh, mi, ss].every(Number.isFinite)) return null;
  let frac = 0;
  if (s.length > 12 && s.charAt(12) === ".") {
    const f = Number(`0${s.slice(12)}`);
    if (Number.isFinite(f)) frac = f;
  }
  const dt = Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss);
  if (!Number.isFinite(dt)) return null;
  return dt / 1000 + frac;
}

function gpsFixValue(payload: Uint8Array): number {
  if (payload.byteLength < 4) return 0;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return view.getUint32(0, false);
}

async function extractGps(f: RandomAccessFile, tracks: readonly TrackInfo[]): Promise<StampSource> {
  const gpmd = tracks.find((t) => t.handlerType === "meta" && t.sampleFormat === "gpmd");
  if (!gpmd) return missingSource("gps", "no gpmd metadata track");

  // Walk only the first MAX_GPS_SCAN_SAMPLES sample references.
  const allRefs = [];
  for await (const ref of iterSampleRefs(f, gpmd)) {
    allRefs.push(ref);
    if (allRefs.length >= MAX_GPS_SCAN_SAMPLES) break;
  }
  if (allRefs.length === 0) return missingSource("gps", "gpmd track has no samples");

  let bestNoFix: { epoch: number; idx: number } | null = null;

  for (let idx = 0; idx < allRefs.length; idx++) {
    const ref = allRefs[idx];
    if (ref === undefined) continue;
    const data = await readSample(f, ref);
    const gpsu = findRecursive(data, "GPSU");
    if (gpsu === null) continue;
    const epoch = parseGpsu(gpsu.payload);
    if (epoch === null) continue;
    const gpsf = findRecursive(data, "GPSF");
    const fix = gpsf !== null ? gpsFixValue(gpsf.payload) : 0;
    if (fix >= 2) {
      return {
        name: "gps",
        epoch,
        iso: epochToIso(epoch),
        detail: { fix, sample_index: idx, scanned: idx + 1 },
      };
    }
    if (bestNoFix === null) bestNoFix = { epoch, idx };
  }

  if (bestNoFix !== null) {
    return {
      name: "gps",
      epoch: bestNoFix.epoch,
      iso: epochToIso(bestNoFix.epoch),
      detail: {
        fix: 0,
        sample_index: bestNoFix.idx,
        scanned: Math.min(allRefs.length, MAX_GPS_SCAN_SAMPLES),
        warning: "GPSU read without GPS fix; clock may be approximate",
      },
    };
  }

  return missingSource("gps", "no GPSU found in scanned samples");
}

// CDAT lives in udta/GPMF as KLV. Per docs, it's local-time epoch seconds.
async function extractCdat(f: RandomAccessFile, moov: Atom): Promise<StampSource> {
  const udta = await findFirst(f, "udta", moov.payloadOffset, moov.end);
  if (udta === null) return missingSource("cdat", "no udta atom");
  const udtaGpmf = await findFirst(f, "GPMF", udta.payloadOffset, udta.end);
  if (udtaGpmf === null) return missingSource("cdat", "no GPMF atom in udta");
  f.seek(udtaGpmf.payloadOffset);
  const blob = await f.read(udtaGpmf.payloadSize);
  const cdat = findRecursive(blob, "CDAT");
  if (cdat === null || cdat.payload.byteLength === 0) {
    return missingSource("cdat", "no CDAT key in udta GPMF");
  }
  const view = new DataView(cdat.payload.buffer, cdat.payload.byteOffset, cdat.payload.byteLength);
  let epoch: number;
  if (cdat.structSize === 8) {
    const hi = view.getUint32(0, false);
    const lo = view.getUint32(4, false);
    epoch = hi * 0x1_0000_0000 + lo;
  } else if (cdat.structSize === 4) {
    epoch = view.getUint32(0, false);
  } else {
    return missingSource("cdat", `unexpected CDAT struct_size ${cdat.structSize}`);
  }
  return {
    name: "cdat",
    epoch,
    iso: epochToIso(epoch),
    detail: { warning: "CDAT is documented as local-time epoch (no TZ)" },
  };
}

const CAMERA_TAGS = new Set<CameraTag>(["FIRM", "CAME", "LENS"]);

function isCameraTag(s: string): s is CameraTag {
  return CAMERA_TAGS.has(s as CameraTag);
}

async function extractCameraInfo(f: RandomAccessFile, moov: Atom): Promise<CameraInfo> {
  const info: CameraInfo = {};
  const udta = await findFirst(f, "udta", moov.payloadOffset, moov.end);
  if (udta === null) return info;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for await (const child of walk(f, udta.payloadOffset, udta.end)) {
    if (child.depth !== 0) continue;
    if (!isCameraTag(child.fourcc)) continue;
    f.seek(child.payloadOffset);
    const raw = await f.read(child.payloadSize);
    info[child.fourcc] = decoder.decode(raw).split(NUL_CHAR).join("").trim();
  }
  return info;
}

export async function extractTimestamps(
  blobName: string,
  f: RandomAccessFile,
): Promise<TimestampReport> {
  const moov = await findFirst(f, "moov");
  if (moov === null) {
    throw new Error(`${blobName}: no moov atom (not an MP4/MOV?)`);
  }
  const tracks = await collectTracks(f, moov);

  const sources: Partial<Record<SourceName, StampSource>> = {
    mvhd: await extractMvhd(f, moov),
    mdhd: extractMdhd(tracks),
    gps: await extractGps(f, tracks),
    cdat: await extractCdat(f, moov),
  };
  const camera = await extractCameraInfo(f, moov);

  let selectedSource: SourceName | null = null;
  for (const name of DEFAULT_AUTO_ORDER) {
    const s = sources[name];
    if (s && s.epoch !== null) {
      selectedSource = name;
      break;
    }
  }
  const selected = selectedSource ? sources[selectedSource] : null;

  return {
    file: blobName,
    fileSize: f.size,
    sources,
    selectedSource,
    selectedEpoch: selected?.epoch ?? null,
    selectedIso: selected?.iso ?? null,
    camera,
  };
}
