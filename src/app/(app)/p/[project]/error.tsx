"use client";

import { ErrorScreen } from "@/components/status-screens";

/** Error boundary of this segment: shows a reference and lets the user retry. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen digest={error.digest} onRetry={retry} homeHref="/" />;
}
