import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { buildMetadataForPathname, PATHNAME_HEADER_NAME } from '@/lib/metadata';
import './globals.css';
import { Providers } from './providers';

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get(PATHNAME_HEADER_NAME) ?? '/';
  return buildMetadataForPathname(pathname);
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
