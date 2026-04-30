import type { TimestampReport } from "../lib/mp4/timestamps.ts";
import styles from "./ResultCard.module.css";

export type CardState =
  | { kind: "pending"; file: File }
  | { kind: "ok"; file: File; report: TimestampReport }
  | { kind: "error"; file: File; message: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
          <span className={styles.badge}>MP4</span>
          <span className={styles.filename} title={file.name}>
            {file.name}
          </span>
          <span className={styles.filesize}>{formatBytes(file.size)}</span>
        </div>
        <div className={styles.spinner}>Reading…</div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={`${styles.badge} ${styles.badgeError}`}>?</span>
          <span className={styles.filename} title={file.name}>
            {file.name}
          </span>
          <span className={styles.filesize}>{formatBytes(file.size)}</span>
        </div>
        <div className={styles.error}>{state.message}</div>
      </div>
    );
  }

  const { report } = state;
  const selected = report.selectedSource ? report.sources[report.selectedSource] : null;
  const otherSources = (Object.keys(report.sources) as Array<keyof typeof report.sources>).filter(
    (k) => k !== report.selectedSource && report.sources[k].epoch !== null,
  );
  const cameraEntries = Object.entries(report.camera);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.badge}>MP4</span>
        <span className={styles.filename} title={file.name}>
          {file.name}
        </span>
        <span className={styles.filesize}>{formatBytes(file.size)}</span>
      </div>

      {selected ? (
        <>
          <div className={styles.timestamp}>
            {selected.iso}
            <span className={styles.sourceTag}>[{selected.name}]</span>
          </div>
          {typeof selected.detail.warning === "string" && (
            <div className={styles.warn}>{selected.detail.warning}</div>
          )}
        </>
      ) : (
        <div className={styles.error}>No usable timestamp in mvhd or mdhd.</div>
      )}

      {otherSources.map((name) => {
        const s = report.sources[name];
        return (
          <div key={name} className={styles.alt}>
            {s.iso} [{s.name}] alternative
          </div>
        );
      })}

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
