import { type DragEvent, type ReactNode, useCallback, useRef, useState } from "react";
import styles from "./DropZone.module.css";

interface Props {
  onFiles: (files: File[]) => void;
  empty: boolean;
  placeholder: string;
  children: ReactNode;
}

const ACCEPT = ".mp4,.mov,video/mp4,video/quicktime";

export function DropZone({ onFiles, empty, placeholder, children }: Props) {
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(() => inputRef.current?.click(), []);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHover(true);
  }, []);

  const onDragLeave = useCallback(() => setHover(false), []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setHover(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onFiles(files);
    },
    [onFiles],
  );

  return (
    <div
      className={`${styles.dropZone} ${hover ? styles.hover : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {empty ? (
        <button
          type="button"
          className={styles.placeholder}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open();
            }
          }}
        >
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
