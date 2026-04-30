// RaceChrono v3 CSV first-timestamp reader — port of `external/rc_csv.py`.
//
// RaceChrono v3 exports CSV logs whose first column is Unix epoch seconds
// with millisecond precision (e.g. `1723472631.500`). Header rows are
// non-numeric, so the first row whose column 0 matches \d+\.\d+ is data.
// We stream the file line-by-line and stop on the first match.

import { readLines } from "./lineStream.ts";

// Match a positive number with at least one decimal place (mirrors the
// reference Deno implementation), so integer-only header values like row
// indices don't accidentally match.
const EPOCH_RE = /^\d+\.\d+$/;

export async function rcCsvFirstTimestamp(blob: Blob): Promise<number | null> {
  for await (const line of readLines(blob)) {
    const head = line.split(",", 1)[0]?.trim() ?? "";
    if (EPOCH_RE.test(head)) {
      const n = Number(head);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
