export const metadata = {
  title: "Lexenty — Dashboard",
  description: "Aseguramiento de ejecución para flotas",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
