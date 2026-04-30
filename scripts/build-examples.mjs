#!/usr/bin/env node
// One-shot generator for public/examples/{example.mp4,example.tcx,example.csv,unknown.zip}.
// The four files showcase every card variant in the UI:
//   example.mp4 → reference (the first MP4 with a valid timestamp wins)
//   example.tcx → offset by 7s   (started after the reference)
//   example.csv → offset by 0.435s
//   unknown.zip → unsupported extension (renders the gray ? badge)
// Re-run when changing any demo timestamp.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "public", "examples");
mkdirSync(OUT, { recursive: true });

const REF_ISO = "2024-08-15T10:30:00.000Z";
const REF_UNIX = Math.floor(Date.parse(REF_ISO) / 1000);
const QT_EPOCH_OFFSET = 2_082_844_800;

const TCX_ISO = "2024-08-15T10:30:07.000Z";
const CSV_FRACTIONAL = ".435"; // CSV epoch is REF_UNIX + 0.435s

// ── MP4 ──────────────────────────────────────────────────────────────────
// Minimum file the extractor accepts: ftyp + moov(mvhd v0). The mvhd holds
// the timestamp the app reports.
function box(type, payload) {
  const size = 8 + payload.length;
  const head = Buffer.alloc(8);
  head.writeUInt32BE(size, 0);
  head.write(type, 4, 4, "ascii");
  return Buffer.concat([head, payload]);
}

function ftyp() {
  const payload = Buffer.alloc(16);
  payload.write("isom", 0, 4, "ascii");
  payload.writeUInt32BE(512, 4);
  payload.write("isom", 8, 4, "ascii");
  payload.write("avc1", 12, 4, "ascii");
  return box("ftyp", payload);
}

function mvhd(unix) {
  const qt = unix + QT_EPOCH_OFFSET;
  // 4 (version+flags) + 96 standard v0 fields = 100 bytes payload.
  const buf = Buffer.alloc(100);
  // version=0, flags=0 (already zero).
  buf.writeUInt32BE(qt, 4); // creation_time
  buf.writeUInt32BE(qt, 8); // modification_time
  buf.writeUInt32BE(1000, 12); // timescale
  buf.writeUInt32BE(10_000, 16); // duration → 10 s
  buf.writeUInt32BE(0x0001_0000, 20); // rate 1.0
  buf.writeUInt16BE(0x0100, 24); // volume 1.0
  // reserved (10 bytes) — already zero.
  // matrix (36 bytes): identity in 16.16/2.30.
  const matrix = [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000];
  for (let i = 0; i < 9; i++) buf.writeUInt32BE(matrix[i], 36 + i * 4);
  // pre_defined (24 bytes, zero).
  buf.writeUInt32BE(1, 96); // next_track_ID
  return box("mvhd", buf);
}

const moov = box("moov", mvhd(REF_UNIX));
writeFileSync(resolve(OUT, "example.mp4"), Buffer.concat([ftyp(), moov]));

// ── TCX ──────────────────────────────────────────────────────────────────
const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Other">
      <Id>${TCX_ISO}</Id>
      <Lap StartTime="${TCX_ISO}">
        <TotalTimeSeconds>10</TotalTimeSeconds>
        <DistanceMeters>0</DistanceMeters>
        <Calories>0</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
          <Trackpoint>
            <Time>${TCX_ISO}</Time>
            <Position>
              <LatitudeDegrees>0.0</LatitudeDegrees>
              <LongitudeDegrees>0.0</LongitudeDegrees>
            </Position>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
writeFileSync(resolve(OUT, "example.tcx"), tcx);

// ── RaceChrono v3 CSV ────────────────────────────────────────────────────
// Parser only needs column 0 of any data row to be /^\d+\.\d+$/.
const csv = `"Session","Demo session"
"Vehicle","Demo vehicle"
"Driver","Demo driver"
"Format version","3"

# Time (s),GPS UTC time,GPS latitude (deg),GPS longitude (deg)
${REF_UNIX}${CSV_FRACTIONAL},${REF_ISO.replace(":00.000Z", `:00${CSV_FRACTIONAL}Z`)},0.0,0.0
${REF_UNIX + 1}${CSV_FRACTIONAL},${REF_ISO.replace(":00.000Z", `:01${CSV_FRACTIONAL}Z`)},0.0,0.0
`;
writeFileSync(resolve(OUT, "example.csv"), csv);

// ── unknown.zip ──────────────────────────────────────────────────────────
// Empty file with an unsupported extension — used to demonstrate the
// gray "?" badge and the "unsupported extension" error in the UI.
writeFileSync(resolve(OUT, "unknown.zip"), Buffer.alloc(0));

console.log("wrote example.mp4, example.tcx, example.csv, unknown.zip to", OUT);
console.log(`  example.mp4 → ${REF_ISO}                (reference)`);
console.log(`  example.tcx → ${TCX_ISO}                (offset 7s)`);
console.log(
  `  example.csv → ${REF_ISO.replace(":00.000Z", `:00${CSV_FRACTIONAL}Z`)}            (offset 0.435s)`,
);
console.log("  unknown.zip → unsupported extension");
