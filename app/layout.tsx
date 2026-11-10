import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import { Header } from "@/components/Header";
import { getDeployed } from "@/lib/config";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });
const sans = Public_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Payee Lock",
  description:
    "Confirm who you are paying before crypto leaves. A NEAR registry with a public delay on address changes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { contractId, explorerAccount } = getDeployed();
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <Header />
        <main className="page">{children}</main>
        <footer className="footer">
          <span>Reads public NEAR testnet. No wallet connection. Testnet tokens only.</span>
          {contractId ? (
            <a href={`${explorerAccount}/${contractId}`}>{contractId}</a>
          ) : (
            <span>Contract not deployed</span>
          )}
        </footer>
      </body>
    </html>
  );
}
