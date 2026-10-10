import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AccessReality — Know the barriers before you arrive',
  description: 'A private, source-linked accessibility evidence brief for the venue and requirements you choose.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth"><body><a className="skip-link" href="#main">Skip to main content</a>{children}</body></html>;
}
