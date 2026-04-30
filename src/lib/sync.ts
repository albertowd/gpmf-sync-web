// Cross-format timestamp comparison — port of `sync.py`.
//
// Convention (mirrors gpmf-sync-info Deno reference):
//   - Reference *later* than the other file ⇒ the other file started before
//     the GoPro; trim its head by the delta.
//   - Reference *earlier* than the other file ⇒ the other file started after
//     the GoPro; offset (delay) it by the delta.

import { rcCsvFirstTimestamp } from "./external/rcCsv.ts";
import { tcxFirstTimestamp } from "./external/tcx.ts";
import { DEFAULT_AUTO_ORDER, type TimestampReport, extractTimestamps } from "./mp4/timestamps.ts";
import { RandomAccessFile } from "./randomAccessFile.ts";

export type FileKind = "mp4" | "tcx" | "csv" | "unknown";
export type PrimarySource = "gps" | "mvhd" | "mdhd" | "cdat" | "tcx" | "csv";
export type Action = "reference" | "trim" | "offset" | "aligned";

export interface Candidate {
  readonly source: PrimarySource;
  readonly epoch: number;
  readonly iso: string;
}

export interface FileTimestamp {
  readonly file: string;
  readonly kind: FileKind;
  readonly epoch: number | null;
  readonly iso: string | null;
  readonly primarySource: PrimarySource | null;
  readonly candidates: Candidate[]; // distinct interpretations (incl. primary)
  readonly detail: { error?: string; missing?: string };
  readonly mp4Report?: TimestampReport;
}

export interface AltDelta {
  readonly referenceSource: PrimarySource;
  readonly referenceEpoch: number;
  readonly referenceIso: string;
  readonly deltaSeconds: number;
  readonly action: Action;
}

export interface SyncEntry {
  readonly file: string;
  readonly kind: FileKind;
  readonly epoch: number | null;
  readonly iso: string | null;
  readonly primarySource: PrimarySource | null;
  readonly deltaSeconds: number | null;
  readonly action: Action | null;
  readonly alternatives: AltDelta[];
  readonly detail: { error?: string; missing?: string };
  readonly mp4Report?: TimestampReport;
}

export interface SyncReport {
  readonly referenceFile: string | null;
  readonly referencePrimarySource: PrimarySource | null;
  readonly referenceEpoch: number | null;
  readonly referenceIso: string | null;
  readonly referenceAlternatives: Candidate[]; // excludes primary
  readonly entries: SyncEntry[];
}

const EXT_KIND: Record<string, FileKind> = {
  mp4: "mp4",
  mov: "mp4",
  tcx: "tcx",
  csv: "csv",
};

function classify(name: string): FileKind {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "unknown";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_KIND[ext] ?? "unknown";
}

function epochToIso(epoch: number): string {
  return new Date(epoch * 1000).toISOString().replace(".000Z", "Z");
}

function actionForDelta(delta: number): Action {
  if (delta === 0) return "aligned";
  return delta > 0 ? "offset" : "trim";
}

function mp4Candidates(report: TimestampReport): Candidate[] {
  const seen = new Set<number>();
  const out: Candidate[] = [];
  for (const name of DEFAULT_AUTO_ORDER) {
    const s = report.sources[name];
    if (!s || s.epoch === null || s.iso === null) continue;
    // Round to 1ms so 14:48:53.000 and 14:48:53.0000001 aren't treated as different.
    const key = Math.round(s.epoch * 1000);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: name, epoch: s.epoch, iso: s.iso });
  }
  return out;
}

export async function readFirstTimestamp(file: File): Promise<FileTimestamp> {
  const kind = classify(file.name);

  if (kind === "mp4") {
    let report: TimestampReport;
    try {
      const raf = new RandomAccessFile(file);
      report = await extractTimestamps(file.name, raf);
    } catch (e) {
      return {
        file: file.name,
        kind,
        epoch: null,
        iso: null,
        primarySource: null,
        candidates: [],
        detail: { error: e instanceof Error ? e.message : String(e) },
      };
    }
    const candidates = mp4Candidates(report);
    if (candidates.length === 0) {
      return {
        file: file.name,
        kind,
        epoch: null,
        iso: null,
        primarySource: null,
        candidates: [],
        detail: { missing: "no usable source" },
        mp4Report: report,
      };
    }
    const primary = candidates[0];
    if (!primary) throw new Error("unreachable: candidates non-empty");
    return {
      file: file.name,
      kind,
      epoch: primary.epoch,
      iso: primary.iso,
      primarySource: primary.source,
      candidates,
      detail: {},
      mp4Report: report,
    };
  }

  if (kind === "tcx") {
    const epoch = await tcxFirstTimestamp(file);
    if (epoch === null) {
      return {
        file: file.name,
        kind,
        epoch: null,
        iso: null,
        primarySource: null,
        candidates: [],
        detail: { missing: "no <Id> found" },
      };
    }
    const iso = epochToIso(epoch);
    return {
      file: file.name,
      kind,
      epoch,
      iso,
      primarySource: "tcx",
      candidates: [{ source: "tcx", epoch, iso }],
      detail: {},
    };
  }

  if (kind === "csv") {
    const epoch = await rcCsvFirstTimestamp(file);
    if (epoch === null) {
      return {
        file: file.name,
        kind,
        epoch: null,
        iso: null,
        primarySource: null,
        candidates: [],
        detail: { missing: "no numeric epoch in column 0 (expected RaceChrono v3 CSV)" },
      };
    }
    const iso = epochToIso(epoch);
    return {
      file: file.name,
      kind,
      epoch,
      iso,
      primarySource: "csv",
      candidates: [{ source: "csv", epoch, iso }],
      detail: {},
    };
  }

  return {
    file: file.name,
    kind: "unknown",
    epoch: null,
    iso: null,
    primarySource: null,
    candidates: [],
    detail: { missing: `unsupported extension on '${file.name}'` },
  };
}

function pickReference(stamps: readonly FileTimestamp[]): FileTimestamp | null {
  for (const s of stamps) if (s.kind === "mp4" && s.epoch !== null) return s;
  for (const s of stamps) if (s.epoch !== null) return s;
  return null;
}

export function buildSyncReport(stamps: readonly FileTimestamp[]): SyncReport {
  const ref = pickReference(stamps);

  if (ref === null) {
    return {
      referenceFile: null,
      referencePrimarySource: null,
      referenceEpoch: null,
      referenceIso: null,
      referenceAlternatives: [],
      entries: stamps.map((s) => ({
        file: s.file,
        kind: s.kind,
        epoch: s.epoch,
        iso: s.iso,
        primarySource: s.primarySource,
        deltaSeconds: null,
        action: null,
        alternatives: [],
        detail: s.detail,
        ...(s.mp4Report !== undefined ? { mp4Report: s.mp4Report } : {}),
      })),
    };
  }

  const primaryCandidate: Candidate =
    ref.candidates[0] ??
    ({
      source: (ref.primarySource ?? "mvhd") as PrimarySource,
      epoch: ref.epoch ?? 0,
      iso: ref.iso ?? "",
    } satisfies Candidate);
  const altCandidates = ref.candidates.length > 1 ? ref.candidates.slice(1) : [];

  const entries: SyncEntry[] = stamps.map((s) => {
    if (s.epoch === null) {
      return {
        file: s.file,
        kind: s.kind,
        epoch: null,
        iso: null,
        primarySource: s.primarySource,
        deltaSeconds: null,
        action: null,
        alternatives: [],
        detail: s.detail,
        ...(s.mp4Report !== undefined ? { mp4Report: s.mp4Report } : {}),
      };
    }
    if (s === ref) {
      return {
        file: s.file,
        kind: s.kind,
        epoch: s.epoch,
        iso: s.iso,
        primarySource: s.primarySource,
        deltaSeconds: 0,
        action: "reference",
        alternatives: [],
        detail: s.detail,
        ...(s.mp4Report !== undefined ? { mp4Report: s.mp4Report } : {}),
      };
    }
    const delta = s.epoch - primaryCandidate.epoch;
    const alts: AltDelta[] = altCandidates.map((c) => {
      const d = (s.epoch as number) - c.epoch;
      return {
        referenceSource: c.source,
        referenceEpoch: c.epoch,
        referenceIso: c.iso,
        deltaSeconds: d,
        action: actionForDelta(d),
      };
    });
    return {
      file: s.file,
      kind: s.kind,
      epoch: s.epoch,
      iso: s.iso,
      primarySource: s.primarySource,
      deltaSeconds: delta,
      action: actionForDelta(delta),
      alternatives: alts,
      detail: s.detail,
      ...(s.mp4Report !== undefined ? { mp4Report: s.mp4Report } : {}),
    };
  });

  return {
    referenceFile: ref.file,
    referencePrimarySource: primaryCandidate.source,
    referenceEpoch: primaryCandidate.epoch,
    referenceIso: primaryCandidate.iso,
    referenceAlternatives: altCandidates,
    entries,
  };
}

export function formatDelta(deltaSeconds: number): string {
  const sign = deltaSeconds < 0 ? "-" : "";
  const totalMs = Math.round(Math.abs(deltaSeconds) * 1000);
  const hours = Math.floor(totalMs / (3600 * 1000));
  const restMs1 = totalMs - hours * 3600 * 1000;
  const minutes = Math.floor(restMs1 / (60 * 1000));
  const restMs2 = restMs1 - minutes * 60 * 1000;
  const seconds = Math.floor(restMs2 / 1000);
  const millis = restMs2 - seconds * 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${sign}${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}

export function describeAction(action: Action | null, deltaSeconds: number | null): string {
  if (action === null || deltaSeconds === null) return "--";
  if (action === "reference") return "(reference)";
  if (action === "aligned") return "aligned";
  if (action === "offset") return `offset by ${formatDelta(deltaSeconds)}`;
  return `trim head by ${formatDelta(Math.abs(deltaSeconds))}`;
}
