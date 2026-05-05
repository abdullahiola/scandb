"use client";

import { ThemeProvider } from "./ThemeProvider";
import BottomNav from "./BottomNav";
import { ReactNode } from "react";

export default function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <BottomNav />
    </ThemeProvider>
  );
}
