import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AssessFlow — Оценка и развитие команды",
  description: "Платформа оценки компетенций сотрудников",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
