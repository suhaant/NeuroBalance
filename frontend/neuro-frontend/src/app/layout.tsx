import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "NeuroBalance",
  description:
    "NeuroBalance helps people with neurological conditions like Parkinson’s improve eye–hand coordination through interactive eye-tracking games.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} antialiased bg-gradient-to-br from-gray-50 to-gray-200 text-gray-900`}
      >
        <div className="max-w-5xl mx-auto px-6 py-10">
          {/* App Title + Explanation */}
          <header className="mb-10 text-center">
            <h1 className="text-4xl font-bold tracking-tight text-blue-700 mb-6">
              NeuroBalance
            </h1>
            <div className="bg-white/90 shadow-md rounded-xl p-6 max-w-3xl mx-auto">
              <p className="text-lg leading-relaxed text-gray-800">
                <span className="font-semibold text-blue-800">NeuroBalance</span>{" "}
                is an interactive tool designed to support individuals with
                neurological conditions such as Parkinson’s. By using{" "}
                <span className="font-semibold">eye-tracking technology</span>,
                it helps measure{" "}
                <strong className="text-blue-700">reaction time (latency)</strong>,{" "}
                <strong className="text-blue-700">precision (accuracy)</strong>, and{" "}
                <strong className="text-blue-700">control stability (drift)</strong>{" "}
                through engaging games.
              </p>
              <p className="mt-4 text-gray-700">
                These metrics reveal subtle motor and cognitive changes over time —
                empowering users and clinicians with meaningful insights.
              </p>
            </div>
          </header>

          {/* Main App Content */}
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
