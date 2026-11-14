import type { Metadata } from "next";
import "./globals.css";
import "./workspace.css";
import "./appearance.css";
import { themeInitializationScript } from "@/lib/appearance-preferences";
import { AppShell } from "./app-shell";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "IELTS Adaptive Coach",
  description: "Explainable adaptive IELTS study planning and writing feedback",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} /></head>
      <body><Providers><AppShell>{children}</AppShell></Providers></body>
    </html>
  );
}
