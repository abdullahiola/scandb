import type { Metadata } from "next";
import "./globals.css";
import BottomNavWrapper from "@/components/BottomNavWrapper";

export const metadata: Metadata = {
  title: "ScanDB — Scan to Database",
  description: "Scan a document and download it as a database file.",
  icons: {
    icon: "/favicon.ico",
  },
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
        <BottomNavWrapper />
      </body>
    </html>
  );
}
