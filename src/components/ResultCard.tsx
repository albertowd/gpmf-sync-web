import type { Candidate, FileKind, SyncEntry } from "../lib/sync.ts";
import { describeAction } from "../lib/sync.ts";
import styles from "./ResultCard.module.css";

export type CardState =
  | { kind: "pending"; file: File }
  | {
      kind: "ready";
      file: File;
      entry: SyncEntry;
      isReference: boolean;
      referenceAlternatives: readonly Candidate[];
    };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function badgeClass(kind: FileKind): string {
  if (kind === "tcx") return `${styles.badge} ${styles.tcx}`;
  if (kind === "csv") return `${styles.badge} ${styles.csv}`;
  if (kind === "unknown") return `${styles.badge} ${styles.unknown}`;
  return styles.badge;
}

function badgeLabel(kind: FileKind): string {
  if (kind === "unknown") return "?";
  return kind.toUpperCase();
}

interface Props {
  state: CardState;
}

export function ResultCard({ state }: Props) {
  const { file } = state;

  if (state.kind === "pending") {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.badge}>···</span>
          <span className={styles.filename} title={file.name}>
            {file.name}
          </span>
          <span className={styles.filesize}>{formatBytes(file.size)}</span>
        </div>
        <div className={styles.spinner}>Reading…</div>
      </div>
    );
  }

  const { entry, isReference, referenceAlternatives } = state;
  const cardClass = isReference ? `${styles.card} ${styles.reference}` : styles.card;

  if (entry.epoch === null) {
    const reason = entry.detail.error ?? entry.detail.missing ?? "no timestamp";
    return (
      <div className={cardClass}>
        <div className={styles.header}>
          <span className={badgeClass(entry.kind)}>{badgeLabel(entry.kind)}</span>
          <span className={styles.filename} title={file.name}>
            {file.name}
          </span>
          <span className={styles.filesize}>{formatBytes(file.size)}</span>
        </div>
        <div className={styles.error}>Could not read: {reason}</div>
      </div>
    );
  }

  const camera = entry.mp4Report?.camera ?? {};
  const cameraEntries = Object.entries(camera);
  const sourceTag = entry.primarySource ? ` [${entry.primarySource}]` : "";

  return (
    <div className={cardClass}>
      <div className={styles.header}>
        <span className={badgeClass(entry.kind)}>{badgeLabel(entry.kind)}</span>
        <span className={styles.filename} title={file.name}>
          {file.name}
        </span>
        <span className={styles.filesize}>{formatBytes(file.size)}</span>
        {isReference && <span className={styles.refTag}>REFERENCE</span>}
      </div>

      <div className={styles.timestamp}>
        {entry.iso}
        <span className={styles.sourceTag}>{sourceTag}</span>
      </div>

      {isReference ? (
        <>
          {referenceAlternatives.map((c) => (
            <div key={c.source} className={styles.altRow}>
              {c.iso} [{c.source}] alternative
            </div>
          ))}
          {referenceAlternatives.length > 0 && (
            <div className={styles.disagreementHint}>
              MP4 sources disagree — pick the row whose timezone matches your other files.
            </div>
          )}
        </>
      ) : (
        <>
          {entry.action !== null && (
            <div className={`${styles.action} ${styles[entry.action] ?? ""}`}>
              →{"  "}
              {describeAction(entry.action, entry.deltaSeconds)}
            </div>
          )}
          {entry.alternatives.map((alt) => (
            <div key={alt.referenceSource} className={styles.altIndent}>
              alt vs [{alt.referenceSource}] {alt.referenceIso}:{"  "}
              {describeAction(alt.action, alt.deltaSeconds)}
            </div>
          ))}
        </>
      )}

      {cameraEntries.length > 0 && (
        <div className={styles.camera}>
          {cameraEntries.map(([k, v]) => (
            <span key={k}>
              <span className={styles.cameraKey}>{k}</span> {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
