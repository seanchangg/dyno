import type { Metadata } from "next";
import { Jost } from "next/font/google";
import "./globals.css";
import SupabaseProvider from "@/providers/SupabaseProvider";
import AuthProvider from "@/providers/AuthProvider";
import AgentStatusProvider from "@/providers/AgentStatusProvider";

const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Marty",
  description: "Personal Agent Dashboard",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${jost.variable} font-sans antialiased`}>
        <SupabaseProvider>
          <AuthProvider>
            <AgentStatusProvider>{children}</AgentStatusProvider>
          </AuthProvider>
        </SupabaseProvider>
      </body>
    </html>
  );
}
