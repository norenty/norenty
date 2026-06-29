import Link from "next/link";

export default function NotFound() {
  return (
    <div className="h-screen flex items-center justify-center bg-surface-alt">
      <div className="text-center">
        <div className="text-6xl font-bold text-ink-muted mb-2">404</div>
        <p className="text-sm text-ink-secondary mb-6">Página no encontrada</p>
        <Link
          href="/"
          className="text-sm px-4 py-2 rounded-md bg-brand text-white font-medium no-underline"
        >
          Volver al dashboard
        </Link>
      </div>
    </div>
  );
}
