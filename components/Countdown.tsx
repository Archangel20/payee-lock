"use client";

import { useEffect, useState } from "react";

export function Countdown({ activatesAt, chainNow }: { activatesAt: number; chainNow: number }) {
  const [now, setNow] = useState(chainNow);
  useEffect(() => {
    const skew = chainNow - Date.now();
    const id = window.setInterval(() => setNow(Date.now() + skew), 250);
    return () => window.clearInterval(id);
  }, [chainNow]);
  const seconds = Math.max(0, Math.ceil((activatesAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return (
    <strong className="count">
      {minutes}:{rest}
    </strong>
  );
}
