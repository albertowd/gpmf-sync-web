import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./App.module.css";
import { MobileDropZone } from "./components/MobileDropZone.tsx";
import { type CardState, ResultCard } from "./components/ResultCard.tsx";
import { describeAction } from "./lib/format.ts";
import type { FileTimestamp, SyncReport } from "./lib/sync.ts";

type ParserModule = typeof import("./lib/sync.ts");
type DropZoneModule = typeof import("./components/DropZone.tsx");
type DropZoneProps = Parameters<typeof MobileDropZone>[0];
type DropZoneComponent = ComponentType<DropZoneProps>;

let parserPromise: Promise<ParserModule> | null = null;
function loadParser(): Promise<ParserModule> {
  if (!parserPromise) parserPromise = import("./lib/sync.ts");
  return parserPromise;
}

// Touch devices can't drag-and-drop between windows, so the desktop
// DropZone (with drag handlers + hover state) is loaded as a separate
// chunk and skipped entirely on mobile.
const IS_TOUCH_ONLY =
  typeof window !== "undefined" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;

const DESKTOP_PLACEHOLDER = "Drop GoPro MP4 / TCX / CSV files here  —  or click to browse.";
const MOBILE_PLACEHOLDER = "Tap to browse GoPro MP4 / TCX / CSV files.";
const PLACEHOLDER = IS_TOUCH_ONLY ? MOBILE_PLACEHOLDER : DESKTOP_PLACEHOLDER;
const EMPTY_STATUS = IS_TOUCH_ONLY ? "Tap below to add files." : "Drop files to begin.";

const EMPTY_REPORT: SyncReport = {
  referenceFile: null,
  referencePrimarySource: null,
  referenceEpoch: null,
  referenceIso: null,
  referenceAlternatives: [],
  entries: [],
};

interface Slot {
  file: File;
  key: string;
  stamp: FileTimestamp | null; // null while pending
}

function fileKey(f: File): string {
  return `${f.name}::${f.size}::${f.lastModified}`;
}

function truncatePath(s: string, max = 60): string {
  if (s.length <= max) return s;
  const keep = max - 3;
  const head = Math.max(Math.floor(keep / 3), 6);
  const tail = keep - head;
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

export default function App() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [parser, setParser] = useState<ParserModule | null>(null);
  const [DesktopDropZone, setDesktopDropZone] = useState<DropZoneComponent | null>(null);

  useEffect(() => {
    if (IS_TOUCH_ONLY) return;
    let cancelled = false;
    void import("./components/DropZone.tsx").then((mod: DropZoneModule) => {
      if (!cancelled) setDesktopDropZone(() => mod.DropZone);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const Zone: DropZoneComponent = DesktopDropZone ?? MobileDropZone;

  const finishedStamps = useMemo<FileTimestamp[]>(
    () =>
      slots
        .filter((s): s is Slot & { stamp: FileTimestamp } => s.stamp !== null)
        .map((s) => s.stamp),
    [slots],
  );

  const report = useMemo<SyncReport>(
    () => (parser ? parser.buildSyncReport(finishedStamps) : EMPTY_REPORT),
    [parser, finishedStamps],
  );

  const status = useMemo(() => {
    if (slots.length === 0) return EMPTY_STATUS;
    const pending = slots.filter((s) => s.stamp === null).length;
    if (pending > 0) return `Reading ${slots.length} file(s) — ${pending} pending`;
    if (report.referenceFile === null) {
      return `${slots.length} file(s) — no usable reference.`;
    }
    return `${slots.length} file(s) — reference: ${truncatePath(report.referenceFile, 50)}`;
  }, [slots, report]);

  const onFiles = useCallback((files: File[]) => {
    setSlots((prev) => {
      const existing = new Set(prev.map((s) => s.key));
      const fresh = files
        .filter((f) => !existing.has(fileKey(f)))
        .map<Slot>((file) => ({ file, key: fileKey(file), stamp: null }));
      if (fresh.length === 0) return prev;

      void (async () => {
        const mod = await loadParser();
        setParser((cur) => cur ?? mod);
        for (const slot of fresh) {
          void (async () => {
            const stamp = await mod.readFirstTimestamp(slot.file).catch<FileTimestamp>((err) => ({
              file: slot.file.name,
              kind: "unknown",
              epoch: null,
              iso: null,
              primarySource: null,
              candidates: [],
              detail: { error: err instanceof Error ? err.message : String(err) },
            }));
            setSlots((cur) => cur.map((s) => (s.key === slot.key ? { ...s, stamp } : s)));
          })();
        }
      })();

      return [...prev, ...fresh];
    });
  }, []);

  const onClear = useCallback(() => setSlots([]), []);

  const rawText = useMemo(() => buildRawText(slots, report), [slots, report]);

  return (
    <div className={styles.app}>
      <div className={styles.header}>
        <p className={styles.subtitle}>
          Compare first-timestamps across GoPro MP4, TCX, and RaceChrono v3 CSV files. Files never
          leave your browser.
        </p>
      </div>

      <div className={styles.statusBar}>
        <span className={styles.status}>{status}</span>
        <button type="button" onClick={onClear} disabled={slots.length === 0}>
          Clear
        </button>
      </div>

      <div className={styles.cardsArea}>
        <Zone onFiles={onFiles} empty={slots.length === 0} placeholder={PLACEHOLDER}>
          {slots.map((slot) => {
            const cardState: CardState = makeCardState(slot, report);
            return <ResultCard key={slot.key} state={cardState} />;
          })}
        </Zone>
      </div>

      <div className={styles.consoleSep} />
      <div className={styles.consoleSection}>
        <button
          type="button"
          className={styles.consoleToggle}
          onClick={() => setShowRaw((v) => !v)}
          style={{
            background: "transparent",
            border: "none",
            width: "100%",
            textAlign: "left",
          }}
        >
          {showRaw ? "▼  Hide raw output" : "▶  Show raw output"}
        </button>
        {showRaw && (
          <div className={styles.consoleBody}>
            <textarea readOnly value={rawText} className={styles.consoleText} spellCheck={false} />
          </div>
        )}
      </div>
    </div>
  );
}

function makeCardState(slot: Slot, report: SyncReport): CardState {
  if (slot.stamp === null) return { kind: "pending", file: slot.file };
  const entry = report.entries.find((e) => e.file === slot.stamp?.file);
  if (!entry) {
    // Should be impossible — every finished stamp produces an entry. Fall
    // back to a synthetic missing entry so the card still renders.
    return {
      kind: "ready",
      file: slot.file,
      entry: {
        file: slot.file.name,
        kind: slot.stamp.kind,
        epoch: slot.stamp.epoch,
        iso: slot.stamp.iso,
        primarySource: slot.stamp.primarySource,
        deltaSeconds: null,
        action: null,
        alternatives: [],
        detail: slot.stamp.detail,
      },
      isReference: false,
      referenceAlternatives: [],
    };
  }
  const isReference = report.referenceFile === entry.file && entry.action === "reference";
  return {
    kind: "ready",
    file: slot.file,
    entry,
    isReference,
    referenceAlternatives: isReference ? report.referenceAlternatives : [],
  };
}

function buildRawText(slots: readonly Slot[], report: SyncReport): string {
  if (slots.length === 0) return "(no output yet)";
  if (report.referenceFile === null) {
    if (slots.some((s) => s.stamp === null)) return "Reading…";
    return "No usable timestamp in any input.";
  }
  const lines: string[] = [];
  lines.push(
    `reference:   ${report.referenceFile} [${report.referencePrimarySource}]  ${report.referenceIso}`,
  );
  for (const c of report.referenceAlternatives) {
    lines.push(`             ${c.iso} [${c.source}]  (alternative)`);
  }
  if (report.referenceAlternatives.length > 0) {
    lines.push("             MP4 sources disagree — pick the matching timezone.");
  }
  lines.push("");
  for (const e of report.entries) {
    const kindCol = `[${e.kind.padEnd(3, " ")}]`;
    if (e.epoch === null) {
      const reason = e.detail.error ?? e.detail.missing ?? "no timestamp";
      lines.push(`${e.file}  ${kindCol}  -- ${reason}`);
      continue;
    }
    if (e.action === "reference") {
      lines.push(`${e.file}  ${kindCol}  ${e.iso}  (reference)`);
      continue;
    }
    lines.push(`${e.file}  ${kindCol}  ${e.iso}  ${describeAction(e.action, e.deltaSeconds)}`);
    for (const alt of e.alternatives) {
      lines.push(
        `        alt vs [${alt.referenceSource}] ${alt.referenceIso}:  ${describeAction(alt.action, alt.deltaSeconds)}`,
      );
    }
  }
  return lines.join("\n");
}
