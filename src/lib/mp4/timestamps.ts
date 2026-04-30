// Pass-1 timestamp extraction: mvhd + mdhd paths and udta camera info.
// GPMF (GPS / CDAT) extraction lands in pass 2.
// Port of the corresponding sections of `mp4/timestamps.py`.

import type { RandomAccessFile } from "../randomAccessFile.ts";
import type { Atom } from "./atoms.ts";
import { findFirst, walk } from "./atoms.ts";
import type { TrackInfo } from "./meta.ts";
import { collectTracks, parseMvhd } from "./meta.ts";

export type SourceName = "mvhd" | "mdhd";

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
  readonly sources: Record<SourceName, StampSource>;
  readonly selectedSource: SourceName | null;
  readonly selectedEpoch: number | null;
  readonly selectedIso: string | null;
  readonly camera: CameraInfo;
}

const DEFAULT_AUTO_ORDER: readonly SourceName[] = ["mvhd", "mdhd"] as const;
const NUL_CHAR = String.fromCharCode(0);

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
  if (!vide || !vide.mdhd) return missingSource("mdhd", "no video track with mdhd");
  return {
    name: "mdhd",
    epoch: vide.mdhd.creationUnix,
    iso: epochToIso(vide.mdhd.creationUnix),
    detail: { track: "video", duration_seconds: vide.mdhd.durationSeconds },
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
    // Match Python's `.strip("\x00").strip()`: drop NUL padding, then trim whitespace.
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

  const sources: Record<SourceName, StampSource> = {
    mvhd: await extractMvhd(f, moov),
    mdhd: extractMdhd(tracks),
  };
  const camera = await extractCameraInfo(f, moov);

  let selectedSource: SourceName | null = null;
  for (const name of DEFAULT_AUTO_ORDER) {
    if (sources[name].epoch !== null) {
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
