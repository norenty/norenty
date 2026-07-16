import "./globals.css";
import AuthGuard from "./components/AuthGuard";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import GlobalSearch from "./components/GlobalSearch";

export const metadata = {
  title: "Norenty — Dashboard",
  description: "Aseguramiento de ejecución para flotas",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Norenty",
    description: "Aseguramiento de ejecución para flotas",
    type: "website",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#2563EB",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="h-screen flex overflow-hidden print:h-auto print:overflow-visible">
        <AuthGuard>
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <Topbar />
            <main className="flex-1 overflow-y-auto p-3 md:p-5 print:overflow-visible print:p-0">{children}</main>
          </div>
          <GlobalSearch />
        </AuthGuard>
      </body>
    </html>
  );
}
