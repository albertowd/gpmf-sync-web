import type { Action } from "./sync.ts";

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
