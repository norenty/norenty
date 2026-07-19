"use client";

import { Route, ShieldCheck, MapPin, FileCheck2, BellRing } from "lucide-react";

/**
 * Landing pública en norenty.com (2026-07-19, petición explícita del usuario):
 * todo en un solo dominio, sin subdominio de app aparte. Reemplaza el acceso
 * directo al formulario de login como primera pantalla para visitantes sin
 * sesión — el argumento de venta es el producto en sí (cadena de evidencia
 * inviolable), no una landing de marketing tradicional, porque el canal de
 * venta es contacto directo/boca a boca, no tráfico frío. `onAcceder` la
 * controla `AuthGuard` con un toggle de estado local (mismo dominio, sin
 * ruta ni redirección nueva).
 */
const PILARES = [
  {
    icon: ShieldCheck,
    titulo: "Evidencia con hash criptográfico",
    texto:
      "Cada llegada, cada albarán y cada kilómetro queda registrado con una cadena de hash SHA-256 que ni nosotros podemos alterar. Si un cliente disputa un viaje, la prueba ya existe.",
  },
  {
    icon: MapPin,
    titulo: "Sin hardware, sin integración",
    texto:
      "El chófer usa el móvil que ya tiene. Sin instalar cajas GPS ni tacógrafos remotos. Alta de una flota en minutos, no en semanas de implementación.",
  },
  {
    icon: BellRing,
    titulo: "Avisa antes de que sea tarde",
    texto:
      "Retrasos silenciosos, incidencias sin resolver, objetivos de puntualidad o margen incumplidos — el sistema escala la alerta solo, sin que nadie tenga que ir a mirar.",
  },
  {
    icon: FileCheck2,
    titulo: "Aislamiento real entre empresas y equipos",
    texto:
      "Cada empresa ve solo sus datos. Cada gestor ve solo su equipo. Verificado con tests de aislamiento contra la base de datos real, no solo de palabra.",
  },
];

export default function LandingPage({ onAcceder }) {
  return (
    <div className="h-screen overflow-y-auto bg-surface-alt">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="flex items-center gap-2 mb-12">
          <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center text-white">
            <Route size={20} />
          </div>
          <span className="text-xl font-semibold text-ink">Norenty</span>
        </div>

        <h1 className="text-3xl md:text-4xl font-semibold text-ink leading-tight mb-4">
          Aseguramiento de ejecución para flotas de transporte
        </h1>
        <p className="text-base text-ink-secondary leading-relaxed mb-8 max-w-xl">
          Cada hora de llegada, cada foto de entrega y cada kilómetro recorrido, con una
          cadena de evidencia que nadie puede manipular después. No es otro TMS más — es
          la prueba de que tu flota cumple lo que promete.
        </p>

        <button
          onClick={onAcceder}
          className="text-sm px-5 py-2.5 rounded-lg bg-brand text-white font-medium mb-16"
        >
          Acceder
        </button>

        <div className="grid sm:grid-cols-2 gap-5">
          {PILARES.map(({ icon: Icon, titulo, texto }) => (
            <div key={titulo} className="bg-surface border border-border rounded-xl p-5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-brand mb-3">
                <Icon size={16} />
              </div>
              <h3 className="text-sm font-medium text-ink mb-1.5">{titulo}</h3>
              <p className="text-xs text-ink-secondary leading-relaxed">{texto}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-ink-muted mt-16">
          © {new Date().getFullYear()} Norenty. Servidores en la UE.
        </p>
      </div>
    </div>
  );
}
