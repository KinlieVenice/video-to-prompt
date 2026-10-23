import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RE/CAST — AI Video Reenactment Studio",
  description:
    "Analyze a scene once. Reuse any cast, saved voices and reference frames. Prepare manual Google Flow generations and assemble your reenactment locally.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body>{children}</body>
    </html>
  );
}
