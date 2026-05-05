import type { Metadata } from "next";
import { Suspense } from "react";
import BatchReview from "./BatchReview";

export const metadata: Metadata = {
  title: "ScanDB — Batch Scan",
  description: "Upload and process multiple documents at once.",
};

export default function BatchPage() {
  return (
    <Suspense>
      <BatchReview />
    </Suspense>
  );
}
