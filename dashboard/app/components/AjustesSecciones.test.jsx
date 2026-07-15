import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./RequireRol", () => ({
  default: ({ children }) => children,
}));

// Ítem 9.40: smoke tests de renderizado de los subcomponentes extraídos de
// ajustes/page.jsx (908 líneas -> 5 secciones). Grupo A: solo verifica que
// cada componente renderiza sin lanzar con props mínimas válidas y que
// aparece contenido clave -- no sustituye pruebas de interacción (no hay
// @testing-library en el proyecto), pero atrapa errores de wiring de props
// o imports rotos que el build de Next no siempre detecta en JS sin tipos.

const { default: AjustesPerfilSection } = await import("./AjustesPerfilSection.jsx");
const { default: AjustesMfaSection } = await import("./AjustesMfaSection.jsx");
const { default: AjustesBotSection } = await import("./AjustesBotSection.jsx");
const { default: AjustesEmpresaSection } = await import("./AjustesEmpresaSection.jsx");
const { default: AjustesEquipoSection } = await import("./AjustesEquipoSection.jsx");

describe("AjustesPerfilSection", () => {
  it("renderiza email del usuario y preferencias", () => {
    const html = renderToStaticMarkup(
      <AjustesPerfilSection
        user={{ email: "a@x.com", id: "u1" }}
        newPassword=""
        setNewPassword={() => {}}
        guardando={false}
        cambiarPassword={() => {}}
        gestor={{}}
        prefs={{ notif_incidencias: true, notif_entregas: true, notif_fuera_ventana: false }}
        togglePref={() => {}}
        cerrandoSesiones={false}
        onCerrarTodasLasSesiones={() => {}}
        onSignOut={() => {}}
      />
    );
    expect(html).toContain("a@x.com");
    expect(html).toContain("Notificaciones");
    expect(html).toContain("Cerrar sesión");
  });
});

describe("AjustesMfaSection", () => {
  it("renderiza el botón de activar cuando no hay factores", () => {
    const html = renderToStaticMarkup(
      <AjustesMfaSection
        mfaError={null}
        mfaEnrolando={false}
        mfaQr={null}
        mfaSecret={null}
        mfaCodigo=""
        setMfaCodigo={() => {}}
        mfaOcupado={false}
        mfaFactores={[]}
        iniciarEnrolamientoMfa={() => {}}
        confirmarEnrolamientoMfa={() => {}}
        cancelarEnrolamientoMfa={() => {}}
        desactivarMfa={() => {}}
      />
    );
    expect(html).toContain("Activar verificación en dos pasos");
  });

  it("renderiza el factor activo cuando ya está enrolado", () => {
    const html = renderToStaticMarkup(
      <AjustesMfaSection
        mfaError={null}
        mfaEnrolando={false}
        mfaQr={null}
        mfaSecret={null}
        mfaCodigo=""
        setMfaCodigo={() => {}}
        mfaOcupado={false}
        mfaFactores={[{ id: "f1", friendly_name: "Norenty" }]}
        iniciarEnrolamientoMfa={() => {}}
        confirmarEnrolamientoMfa={() => {}}
        cancelarEnrolamientoMfa={() => {}}
        desactivarMfa={() => {}}
      />
    );
    expect(html).toContain("Norenty");
    expect(html).toContain("Activa");
  });
});

describe("AjustesBotSection", () => {
  it("renderiza estado sin señal cuando no hay heartbeat", () => {
    const html = renderToStaticMarkup(
      <AjustesBotSection
        gestor={{ telegram_chat_id: null }}
        bot="NorentyBot"
        copiado={false}
        copiarEnlaceTelegram={() => {}}
        heartbeat={{ activo: false, ultimoLatido: null }}
      />
    );
    expect(html).toContain("SIN SEÑAL");
    expect(html).toContain("Copiar enlace");
  });

  it("renderiza vinculado + activo", () => {
    const html = renderToStaticMarkup(
      <AjustesBotSection
        gestor={{ telegram_chat_id: "chat1" }}
        bot="NorentyBot"
        copiado={false}
        copiarEnlaceTelegram={() => {}}
        heartbeat={{ activo: true, segundosDesdeUltimo: 30 }}
      />
    );
    expect(html).toContain("Vinculado");
    expect(html).toContain("Activo");
  });
});

describe("AjustesEmpresaSection", () => {
  it("renderiza los 5 bloques de configuración de empresa", () => {
    const html = renderToStaticMarkup(
      <AjustesEmpresaSection
        empresa={{ id: "e1234567890" }}
        empresaNombre="Norenty"
        setEmpresaNombre={() => {}}
        guardarEmpresa={() => {}}
        baseLat=""
        setBaseLat={() => {}}
        baseLon=""
        setBaseLon={() => {}}
        guardarBase={() => {}}
        costeKm=""
        setCosteKm={() => {}}
        guardarCoste={() => {}}
        velocidadPlanificacion=""
        setVelocidadPlanificacion={() => {}}
        guardarVelocidad={() => {}}
        velocidadPlanificacionDefault={80}
        precioGasoil=""
        setPrecioGasoil={() => {}}
        costePeaje=""
        setCostePeaje={() => {}}
        dietaNoche=""
        setDietaNoche={() => {}}
        costeConductor=""
        setCosteConductor={() => {}}
        guardarDesglose={() => {}}
        requierePod={true}
        toggleRequierePod={() => {}}
        guardando={false}
      />
    );
    expect(html).toContain("Empresa");
    expect(html).toContain("Ubicación base");
    expect(html).toContain("Coste de operación");
    expect(html).toContain("Velocidad de planificación");
    expect(html).toContain("Prueba de entrega");
    expect(html).toContain("Coste desglosado");
  });
});

describe("AjustesEquipoSection", () => {
  it("renderiza invitaciones y gestores", () => {
    const html = renderToStaticMarkup(
      <AjustesEquipoSection
        invitaciones={[{ id: "i1", email: "b@x.com", usada_at: null, vencida: false }]}
        invitarEmail=""
        setInvitarEmail={() => {}}
        invitando={false}
        enviarInvitacion={() => {}}
        revocarInvitacion={() => {}}
        copiarEnlaceInvitacion={() => {}}
        codigoCopiadoId={null}
        invitacionValidezDias={7}
        gestores={[{ id: "g1", nombre: "Ana", email: "a@x.com", rol: "admin", activo: true, auth_user_id: "u1" }]}
        user={{ id: "u1" }}
        gestorAccionandoId={null}
        cambiarRolGestor={() => {}}
        onDesactivarGestor={() => {}}
        onReactivarGestor={() => {}}
      />
    );
    expect(html).toContain("b@x.com");
    expect(html).toContain("Ana");
    expect(html).toContain("Pendiente");
  });
});
