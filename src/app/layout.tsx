import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RAGNAROK ANALYTICS • FTC BIOBUZZ Telemetry',
  description: 'Centro de mando, picklist y simulador de alianzas 2v2 para FTC BIOBUZZ (2026–2027)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

