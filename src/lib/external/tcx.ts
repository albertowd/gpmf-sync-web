// TCX (Training Center XML) first-timestamp reader — port of `external/tcx.py`.
//
// The first absolute timestamp in a TCX file is `<Id>YYYY-MM-DDTHH:MM:SS[.fff]Z</Id>`
// inside the first <Activity> block. We stream the file line-by-line and return
// as soon as we find the first <Id>, so we don't pay for parsing the rest.

import { readLines } from "./lineStream.ts";

const ID_RE = /<Id>\s*([^<]+?)\s*<\/Id>/i;

function parseIso8601(raw: string): number | null {
  const s = raw.trim();
  if (s.length === 0) return null;
  // Date.parse handles ISO-8601 with trailing Z / offsets in all current
  // browsers. A naive datetime (no offset) is interpreted as local time —
  // TCX timestamps are spec'd as UTC, so we add a Z if no offset is present.
  let normalised = s;
  if (!/[zZ]$/.test(s) && !/[+-]\d{2}:?\d{2}$/.test(s)) {
    normalised = `${s}Z`;
  }
  const ms = Date.parse(normalised);
  if (!Number.isFinite(ms)) return null;
  return ms / 1000;
}

export async function tcxFirstTimestamp(blob: Blob): Promise<number | null> {
  for await (const line of readLines(blob)) {
    const m = line.match(ID_RE);
    if (m && m[1] !== undefined) {
      return parseIso8601(m[1]);
    }
  }
  return null;
}
