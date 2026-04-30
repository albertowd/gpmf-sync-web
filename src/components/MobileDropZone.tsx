import { type ReactNode, useCallback, useRef } from "react";
import styles from "./DropZone.module.css";

interface Props {
  onFiles: (files: File[]) => void;
  empty: boolean;
  placeholder: string;
  children: ReactNode;
}

const ACCEPT =
  ".mp4,.mov,.tcx,.csv,video/mp4,video/quicktime,application/vnd.garmin.tcx+xml,text/csv";

export function MobileDropZone({ onFiles, empty, placeholder, children }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = useCallback(() => inputRef.current?.click(), []);

  return (
    <div className={styles.dropZone}>
      {empty ? (
        <button type="button" className={styles.placeholder} onClick={open}>
          {placeholder}
        </button>
      ) : (
        <div className={styles.cards}>{children}</div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className={styles.hiddenInput}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
