import { Outfit } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Navbar } from "@/components/saas/Navbar";

const font = Outfit({ subsets: ["latin"] });

export const metadata = {
  title: "Resale Photo Enhancer - background swap and enhance product photos",
  description: "Enhance your product photos instantly with background templates or custom prompts.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full w-full" style={{ colorScheme: 'light' }}>
      <body className={`${font.className} h-full w-full flex flex-col antialiased bg-white`}>
        <Providers>
          <Navbar />
          <div className="flex-1 flex flex-col overflow-hidden">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
