import { Route } from "lucide-react";

// Página pública (ítem 9.14) — bypaseada de AuthGuard igual que /t/[token] (7A.14).
// Fuente de verdad de este contenido: PRIVACIDAD-SUBPROCESADORES.md (git-trackeado).
// Cualquier cambio de subencargado real debe reflejarse en AMBOS sitios.
const SUBPROCESADORES = [
  {
    nombre: "Supabase",
    empresa: "Supabase Inc.",
    funcion: "Base de datos (Postgres), autenticación, almacenamiento de ficheros (fotos de POD, documentos)",
    region: "UE — eu-west-1 (Irlanda), confirmado en la configuración real del proyecto",
    dpa: "supabase.com/legal/dpa",
  },
  {
    nombre: "Vercel",
    empresa: "Vercel Inc.",
    funcion: "Alojamiento del dashboard (Next.js)",
    region: "UE — a fijar explícitamente (región Frankfurt) al desplegar (ver DEPLOY.md)",
    dpa: "vercel.com/legal/dpa",
  },
  {
    nombre: "Railway",
    empresa: "Railway Corporation",
    funcion: "Alojamiento del backend y del bot de Telegram",
    region: "UE — a fijar explícitamente al desplegar (ver DEPLOY.md)",
    dpa: "Solicitar el DPA directamente a Railway antes de firmar — no hay una URL pública estable confirmada",
  },
  {
    nombre: "Sentry",
    empresa: "Functional Software, Inc.",
    funcion: "Registro de errores técnicos (opt-in, solo si se configura SENTRY_DSN)",
    region: "Confirmar la opción de residencia de datos en la UE al crear el proyecto de Sentry",
    dpa: "sentry.io/legal/dpa",
  },
];

export default function SubprocesadoresPage() {
  return (
    <div className="min-h-screen bg-surface-alt">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center text-white">
            <Route size={18} />
          </div>
          <span className="text-lg font-semibold text-ink">Norenty</span>
        </div>

        <h1 className="text-xl font-medium text-ink mb-2">Subprocesadores</h1>
        <p className="text-sm text-ink-secondary mb-6">
          Norenty actúa como encargado del tratamiento (processor) de cada empresa cliente
          (responsable/controller). Esta página lista a nuestros propios subencargados — los
          proveedores que tratan datos por cuenta de Norenty para poder prestar el servicio.
          Todos están fijados o en proceso de fijarse explícitamente en la Unión Europea.
        </p>

        <div className="bg-surface border border-border rounded-xl overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-alt text-left text-xs text-ink-secondary">
                <th className="px-4 py-2 font-medium">Subencargado</th>
                <th className="px-4 py-2 font-medium">Función</th>
                <th className="px-4 py-2 font-medium">Región</th>
                <th className="px-4 py-2 font-medium">DPA</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESADORES.map((s) => (
                <tr key={s.nombre} className="border-t border-border align-top">
                  <td className="px-4 py-3 text-ink font-medium whitespace-nowrap">
                    {s.nombre}
                    <div className="text-xs text-ink-muted font-normal">{s.empresa}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">{s.funcion}</td>
                  <td className="px-4 py-3 text-ink-secondary">{s.region}</td>
                  <td className="px-4 py-3 text-ink-secondary break-all">{s.dpa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-ink-muted">
          Última actualización: julio de 2026. Si tu empresa necesita firmar un Acuerdo de
          Encargado de Tratamiento (DPA) con Norenty, contacta con tu gestor de cuenta.
        </p>
      </div>
    </div>
  );
}
