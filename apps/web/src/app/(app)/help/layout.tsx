import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Private conversations. Nothing under /help is for a search engine — the pages are empty
 * without a signed-in customer, and an indexed shell titled "Help" helps nobody.
 */
export const metadata: Metadata = {
  title: 'Help',
  robots: { index: false, follow: false },
};

export default function HelpLayout({ children }: { children: ReactNode }) {
  return children;
}
