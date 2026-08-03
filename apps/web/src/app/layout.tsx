import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Merge review queue | Kritt Radar',
  description: 'Internal evidence review for uncertain entity matches.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to merge queue
        </a>
        {children}
      </body>
    </html>
  );
}
