# Subprocesadores de Norenty

**Fuente de verdad** de la página pública `dashboard/app/subprocesadores/page.jsx` (ítem 9.14).
Cualquier cambio real en la lista de subencargados debe reflejarse en AMBOS sitios.

Norenty actúa como **encargado del tratamiento (processor)** de cada empresa cliente
(**responsable/controller**) — ver `PRIVACIDAD-RAT.md` §0. Esta lista recoge a los propios
subencargados de Norenty: los proveedores que tratan datos por cuenta de Norenty para poder
prestar el servicio.

| Subencargado | Empresa | Función | Región | DPA |
|---|---|---|---|---|
| Supabase | Supabase Inc. | Base de datos (Postgres), autenticación, almacenamiento de ficheros (fotos de POD, documentos) | **UE — eu-west-1 (Irlanda)**, confirmado en la configuración real del proyecto (`get_project` → `region: eu-west-1`) | supabase.com/legal/dpa |
| Vercel | Vercel Inc. | Alojamiento del dashboard (Next.js) | UE — a fijar explícitamente (región Frankfurt) al desplegar, ver `DEPLOY.md` §1 | vercel.com/legal/dpa |
| Railway | Railway Corporation | Alojamiento del backend y del bot de Telegram | UE — a fijar explícitamente al desplegar, ver `DEPLOY.md` §2 | Solicitar directamente a Railway — no hay URL pública estable confirmada |
| Sentry | Functional Software, Inc. | Registro de errores técnicos (opt-in, solo si se configura `SENTRY_DSN`) | Confirmar la opción de residencia de datos en la UE al crear el proyecto de Sentry | sentry.io/legal/dpa |

**Nota honesta sobre las URLs de DPA**: son enlaces de referencia a las páginas legales públicas
de cada proveedor, tal como se conocen hoy — verificar que siguen vigentes antes de publicarlas
o citarlas en un contrato real, los proveedores pueden mover sus páginas legales.

**Cloudflare**: usado hoy solo para DNS del dominio `norenty.com` (ver sección "Despliegue" de
`ROADMAP.md`). Si en el futuro se activa el proxy/CDN de Cloudflare (tráfico "orange-clouded"),
pasaría a tratar datos en tránsito y habría que añadirlo aquí como subencargado — pendiente de
confirmar según la configuración final de despliegue.

**Pendiente explícito**: fijar la región a UE en Vercel y Railway es una acción a ejecutar
DURANTE el despliegue real (`DEPLOY.md`), no algo que se pueda hacer hoy sin tener esos proyectos
creados. Este documento se actualizará con la región real una vez desplegado.
