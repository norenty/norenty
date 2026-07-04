"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X } from "lucide-react";
import { getOnboardingEstado } from "../../lib/data";

const OCULTO_KEY = "norenty_onboarding_oculto";

export default function ChecklistOnboarding() {
  const [estado, setEstado] = useState(null);
  const [oculto, setOculto] = useState(true); // por defecto oculto hasta confirmar localStorage, evita parpadeo

  useEffect(() => {
    getOnboardingEstado().then(setEstado);
    setOculto(localStorage.getItem(OCULTO_KEY) === "1");
  }, []);

  if (!estado || estado.completado || oculto) return null;

  const hechos = estado.pasos.filter((p) => p.done).length;

  function ocultar() {
    localStorage.setItem(OCULTO_KEY, "1");
    setOculto(true);
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-ink">Primeros pasos ({hechos}/{estado.pasos.length})</h2>
        <button onClick={ocultar} aria-label="Ocultar checklist" className="text-ink-muted hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {estado.pasos.map((p) => (
          <Link
            key={p.id}
            href={p.href}
            className={`flex items-center gap-2 text-sm no-underline ${p.done ? "text-ink-muted" : "text-ink hover:text-brand"}`}
          >
            {p.done ? <CheckCircle2 size={16} className="text-estado-ok shrink-0" /> : <Circle size={16} className="shrink-0" />}
            <span className={p.done ? "line-through" : ""}>{p.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
