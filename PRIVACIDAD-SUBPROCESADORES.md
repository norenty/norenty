# Subprocesadores de Norenty

**Fuente de verdad** de la página pública `dashboard/app/subprocesadores/page.jsx` (ítem 9.14).
Cualquier cambio real en la lista de subencargados debe reflejarse en AMBOS sitios.

Norenty actúa como **encargado del tratamiento (processor)** de cada empresa cliente
(**responsable/controller**) — ver `PRIVACIDAD-RAT.md` §0. Esta lista recoge a los propios
subencargados de Norenty: los proveedores que tratan datos por cuenta de Norenty para poder
prestar el servicio.

| Subencargado | Empresa | Función | Región | DPA |
|---|---|---|---|---|
| Supabase | Supabase Inc. | Base de datos (Postgres), autenticación, almacenamiento de ficheros (fotos de POD, documentos) | **UE — eu-central-1 (Frankfurt)**, confirmado en el proyecto de producción real `norenty-prod` (Project Settings → General → Project region) el 2026-07-21 | supabase.com/legal/dpa |
| Vercel | Vercel Inc. | Alojamiento del dashboard (Next.js) | **UE — Frankfurt (fra1)**, confirmado en Project Settings → Functions → Region del proyecto real desplegado el 2026-07-21 | vercel.com/legal/dpa |
| Railway | Railway Corporation | Alojamiento del backend y del bot de Telegram | **UE — EU West (Amsterdam)**, confirmado en Settings → Region del servicio real desplegado el 2026-07-21 | Solicitar directamente a Railway — no hay URL pública estable confirmada |
| Sentry | Functional Software, Inc. | Registro de errores técnicos (opt-in, solo si se configura `SENTRY_DSN`) | **Pendiente D.1 (Fase 17)**: Sentry aún no está activado en producción — confirmar la opción de residencia de datos en la UE al crear el proyecto | sentry.io/legal/dpa |

**Nota honesta sobre las URLs de DPA**: son enlaces de referencia a las páginas legales públicas
de cada proveedor, tal como se conocen hoy — verificar que siguen vigentes antes de publicarlas
o citarlas en un contrato real, los proveedores pueden mover sus páginas legales.

**Cloudflare**: además del DNS de `norenty.com`, gestiona también el correo corporativo (registros
MX/DKIM/SPF) — confirmado 2026-07-21 al desplegar. El registro del dashboard (`norenty.com`/
`www.norenty.com` → Vercel) está en modo **"DNS only"** (nube gris, sin proxy) a petición explícita
de Vercel para la emisión de su propio certificado SSL — por tanto Cloudflare **no** trata el
tráfico del dashboard en tránsito hoy, solo resuelve el DNS. Si en el futuro se activa el proxy
(nube naranja) sobre ese registro, pasaría a tratar datos en tránsito y habría que añadirlo aquí
como subencargado — no es el caso actual.
