import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LR Pendientes",
  description: "Herramienta publica para gestionar pendientes y usuarios por workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
