import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ZeroAgent Dashboard',
  description: 'Monitor and manage your self-evolving agents',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
