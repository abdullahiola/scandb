"use client";

import dynamic from "next/dynamic";

const Repository = dynamic(() => import("./Repository"), { ssr: false });

export default function ClientPage() {
  return <Repository />;
}
