import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScanDB — Scan to Database",
  description: "Scan a document and download it as a database file.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
