import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Frame Extractor - Client-Side Video Frame Extraction",
  description:
    "Extract and view individual frames from video files entirely in your browser. No uploads, no servers, fully private.",
  keywords: [
    "video",
    "frames",
    "extraction",
    "browser",
    "client-side",
    "WebGPU",
    "super-resolution",
    "SAFMN",
    "IndexedDB",
  ],
  authors: [{ name: "Frame Extractor" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Frame Extractor",
    description: "Client-side video frame extraction and viewer",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
