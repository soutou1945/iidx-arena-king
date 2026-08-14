import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IIDX 王決定戦 管理アプリ",
  description: "beatmania IIDX ローカルアリーナ非公式大会の試合・順位管理",
  other: {
    "codex-preview": "development",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
