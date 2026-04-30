import { useCallback, useMemo, useState } from "react";
import styles from "./App.module.css";
import { DropZone } from "./components/DropZone.tsx";
import { type CardState, ResultCard } from "./components/ResultCard.tsx";
import { type TimestampReport, extractTimestamps } from "./lib/mp4/timestamps.ts";
import { RandomAccessFile } from "./lib/randomAccessFile.ts";

const PLACEHOLDER = "Drop GoPro MP4 / MOV files here  —  or click to browse.";

function fileKey(f: File): string {
  return `${f.name}::${f.size}::${f.lastModified}`;
}

export default function App() {
  const [cards, setCards] = useState<CardState[]>([]);
  const [showRaw, setShowRaw] = useState(false);

  const status = useMemo(() => {
    if (cards.length === 0) return "Drop files to begin.";
    const ok = cards.filter((c) => c.kind === "ok").length;
    const errs = cards.filter((c) => c.kind === "error").length;
    const pending = cards.filter((c) => c.kind === "pending").length;
    const parts = [`${cards.length} file(s)`];
    if (pending > 0) parts.push(`${pending} reading`);
    if (errs > 0) parts.push(`${errs} failed`);
    if (ok > 0) parts.push(`${ok} ok`);
    return parts.join(" — ");
  }, [cards]);

  const updateCard = useCallback((key: string, update: Partial<CardState>) => {
    setCards((prev) =>
      prev.map((c) => (fileKey(c.file) === key ? ({ ...c, ...update } as CardState) : c)),
    );
  }, []);

  const onFiles = useCallback(
    (files: File[]) => {
      const existingKeys = new Set(cards.map((c) => fileKey(c.file)));
      const fresh = files.filter((f) => !existingKeys.has(fileKey(f)));
      if (fresh.length === 0) return;

      const newCards: CardState[] = fresh.map((file) => ({ kind: "pending", file }));
      setCards((prev) => [...prev, ...newCards]);

      for (const file of fresh) {
        const key = fileKey(file);
        void (async () => {
          try {
            const raf = new RandomAccessFile(file);
            const report = await extractTimestamps(file.name, raf);
            updateCard(key, { kind: "ok", file, report });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            updateCard(key, { kind: "error", file, message });
          }
        })();
      }
    },
    [cards, updateCard],
  );

  const onClear = useCallback(() => setCards([]), []);

  const rawText = useMemo(() => buildRawText(cards), [cards]);

  return (
    <div className={styles.app}>
      <div className={styles.header}>
        <p className={styles.subtitle}>
          Read first-timestamps from GoPro MP4 files. Files never leave your browser.
        </p>
      </div>

      <div className={styles.statusBar}>
        <span className={styles.status}>{status}</span>
        <button type="button" onClick={onClear} disabled={cards.length === 0}>
          Clear
        </button>
      </div>

      <div className={styles.cardsArea}>
        <DropZone onFiles={onFiles} empty={cards.length === 0} placeholder={PLACEHOLDER}>
          {cards.map((c) => (
            <ResultCard key={fileKey(c.file)} state={c} />
          ))}
        </DropZone>
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

function buildRawText(cards: readonly CardState[]): string {
  if (cards.length === 0) return "(no output yet)";
  const lines: string[] = [];
  for (const c of cards) {
    if (c.kind === "pending") {
      lines.push(`${c.file.name}  -- reading…`);
      continue;
    }
    if (c.kind === "error") {
      lines.push(`${c.file.name}  -- error: ${c.message}`);
      continue;
    }
    const r: TimestampReport = c.report;
    const sel = r.selectedSource ? r.sources[r.selectedSource] : null;
    if (!sel || sel.iso === null) {
      lines.push(`${c.file.name}  -- no usable timestamp`);
      continue;
    }
    lines.push(`${c.file.name}  ${sel.iso}  [${sel.name}]`);
    for (const k of Object.keys(r.sources) as Array<keyof typeof r.sources>) {
      if (k === r.selectedSource) continue;
      const alt = r.sources[k];
      if (alt.iso !== null) {
        lines.push(`    alt: ${alt.iso}  [${alt.name}]`);
      }
    }
    const cam = Object.entries(r.camera)
      .map(([key, val]) => `${key}=${val}`)
      .join("  ");
    if (cam) lines.push(`    camera: ${cam}`);
  }
  return lines.join("\n");
}
