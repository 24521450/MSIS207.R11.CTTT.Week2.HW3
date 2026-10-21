import { useEffect, useState } from "react";
import { createDeadlineTimer } from "../timer/deadlineTimer";

export function useDeadlineCountdown(targetTime: number | null): number {
  const [remainingMs, setRemainingMs] = useState(() =>
    targetTime === null ? 0 : Math.max(0, targetTime - Date.now()),
  );

  useEffect(() => {
    if (targetTime === null) return;
    return createDeadlineTimer(targetTime, setRemainingMs);
  }, [targetTime]);

  return targetTime === null ? 0 : remainingMs;
}
