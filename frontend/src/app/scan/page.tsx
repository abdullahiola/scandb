import type { Metadata } from "next";
import ClientScan from "./ClientScan";

export const metadata: Metadata = {
  title: "ScanDB — Scan Document",
  description: "Scan or upload documents for OCR processing and classification.",
};

export default function ScanPage() {
  return <ClientScan />;
}
