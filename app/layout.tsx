import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://offres.jardin-confort.ch"),
  title: {
    default: "Jardin-Confort",
    template: "%s – Jardin-Confort",
  },
  description: "Jardin-Confort SA, Lutry — offres, commandes et suivi client.",
  applicationName: "Jardin-Confort",
  openGraph: {
    siteName: "Jardin-Confort",
    title: "Jardin-Confort",
    description: "Jardin-Confort SA, Lutry — offres, commandes et suivi client.",
    images: [{ url: "/icon.png", width: 512, height: 512 }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
