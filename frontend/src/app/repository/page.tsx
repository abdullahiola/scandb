import type { Metadata } from "next";
import ClientPage from "./ClientPage";

export const metadata: Metadata = {
  title: "ScanDB — Central Repository",
  description: "Browse, search and manage all scanned staff documents in one place.",
};

export default function RepositoryPage() {
  return <ClientPage />;
}
