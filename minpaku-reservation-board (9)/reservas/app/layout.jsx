export const metadata = {
  title: "予約統合ボード",
  description: "Airbnb / Booking の予約を1画面で",
};
export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <head>
        <meta name="viewport" content="width=1024, viewport-fit=cover" />
        <meta name="theme-color" content="#10151D" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
