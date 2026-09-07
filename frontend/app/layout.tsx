import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./app-shell";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "IELTS Adaptive Coach",
  description: "可解释的雅思自适应学习规划与写作反馈",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><Providers><AppShell>{children}</AppShell></Providers></body>
    </html>
  );
}
