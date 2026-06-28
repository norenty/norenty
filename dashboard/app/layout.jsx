import "./globals.css";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";

export const metadata = {
  title: "Norenty — Dashboard",
  description: "Aseguramiento de ejecución para flotas",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="h-screen flex overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-5">{children}</main>
        </div>
      </body>
    </html>
  );
}
