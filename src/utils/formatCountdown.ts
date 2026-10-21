export function formatCountdown(remainingMs: number): string {
  const safeRemaining = Math.max(0, remainingMs);
  const totalSeconds = Math.floor(safeRemaining / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor(safeRemaining % 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}
