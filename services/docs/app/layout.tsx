import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'JustScan documentation',
    template: '%s | JustScan documentation',
  },
  description: 'Guides for deploying, configuring, and operating JustScan.',
  icons: {
    icon: '/docs/justscan-logo.png',
    apple: '/docs/justscan-logo.png',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ options: { api: '/docs/api/search' } }}>{children}</RootProvider>
      </body>
    </html>
  );
}
