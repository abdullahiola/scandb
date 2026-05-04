"use client";

import dynamic from "next/dynamic";

const ScanApp = dynamic(() => import("./ScanApp"), { ssr: false });

export default function Home() {
  return <ScanApp />;
}
