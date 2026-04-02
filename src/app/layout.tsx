import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "CC QC Tool | Content Cartel",
  description: "Production QC tool for Content Cartel",
  icons: {
    icon: '/favicon.png',
    apple: '/cc-logo.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} antialiased min-h-screen font-[family-name:var(--font-geist-sans)]`}
        style={{ background: "var(--bg)", color: "var(--text)" }}
      >
        {children}
      </body>
    </html>
  );
}
