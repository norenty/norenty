# Onboarding de cliente — qué necesita aportar una empresa para usar Norenty

Documento para el momento en que una flota (empresa + gestor) se da de alta y empieza a usar
Norenty de verdad. Responde a: *"¿qué datos, accesos e integraciones hacen falta por su parte?"*

Principio: **arrancar con lo mínimo y crecer.** Norenty funciona con muy poco el primer día; cada
capa de datos que la empresa puebla desbloquea más valor (coste real, nóminas, cumplimiento 561…),
pero **nada de eso es requisito de arranque**. No hace falta ninguna API ni integración externa
para empezar — el sistema es autónomo.

---

## 0. Lo mínimo imprescindible para el primer viaje

Con esto ya se puede operar el mismo día:

- **1 empresa** (nombre) — se crea sola en el registro.
- **1 gestor** (el que se registra) — email + contraseña.
- **1 vehículo** (matrícula).
- **1 chófer** (nombre + idioma + su Telegram para vincularlo).
- **1 viaje** (una referencia + al menos un punto de recogida y uno de entrega, con dirección).

Todo lo demás de este documento es incremental: mejora las métricas, pero no bloquea el arranque.

---

## 1. Datos de la empresa

| Dato | Para qué sirve | ¿Obligatorio? |
|---|---|---|
| Nombre de la empresa | Identificación, aislamiento de datos | Sí (se pide en el registro) |
| **Base(s) de operación** (dirección → lat/lon) | Calcular "noches fuera" para la nómina | No, pero sin ella la nómina de noches fuera no funciona |
| **Coste por km** (blended de la flota) | Calcular margen/viabilidad de cada viaje | No, pero sin él no hay semáforo de margen |
| **Velocidad de planificación** (km/h, def. 75) | ETA que cumple el Reglamento 561 | No (usa el valor por defecto) |
| **Objetivo de puntualidad (%)** | Comparar rendimiento real contra la meta | No |
| **Margen objetivo (%)** | Presupuestador y semáforo de margen | No |

> Todo esto se configura en **Ajustes → Empresa**, cuando la empresa quiera. Puede empezar sin
> nada de esto y añadirlo cuando vea el valor.

---

## 2. Flota (vehículos)

Por cada camión:
- **Matrícula** (obligatorio).
- Coste/km propio del vehículo (opcional — sobrescribe el de empresa para ese camión).
- Consumo l/100km (opcional — para el desglose de coste por combustible, cuando exista).
- Documentos: ITV, seguro, autorización de transporte (con fechas de caducidad → avisos automáticos).
- Mantenimiento/averías: se registran sobre la marcha, no son un input de arranque.

---

## 3. Chóferes

Por cada chófer:
- **Nombre** (obligatorio).
- **Idioma** — el bot le habla en el suyo (es/en/ro/fr/it/pt/de/ar, todos completos).
- **Telegram** — el chófer abre el bot y pega su código de vinculación (o pulsa el enlace). Es la
  única acción que se le pide al chófer para empezar.
- Documentos: licencia, CAP (con caducidades → avisos).

> **RGPD (importante):** el nombre y los documentos de un chófer son datos personales. Antes de
> meter chóferes REALES (no de prueba), la empresa debe tener el consentimiento del chófer para
> tratar sus datos. Ver sección 8.

---

## 4. Clientes

- Los clientes recurrentes (nombre + contacto) se dan de alta en **Clientes**.
- No es obligatorio: un viaje puede llevar solo una referencia de texto libre. Pero tener el
  cliente como entidad permite análisis por cliente y es la base de la futura captura de
  conocimiento (llamadas, emails, contexto).

---

## 5. Viajes — cómo entran

Tres formas, la empresa elige:
1. **Manual** — formulario de "Nuevo viaje" (o el asistente guiado paso a paso).
2. **Importación Excel/CSV** — el importador ya existe; mapea columnas a viajes/hitos.
3. *(Futuro)* Integración con su TMS — ver sección 7.

Cada viaje necesita: referencia, chófer, vehículo, y sus **hitos** (puntos de recogida/entrega con
dirección y, si se quiere, ventana horaria). Las coordenadas se geocodifican desde la dirección.

---

## 6. Equipo (varios gestores)

- Un gestor ya dado de alta puede **invitar a otros** por email (Ajustes → Equipo).
- Roles: administrador (todo) y solo-lectura. Útil si hay jefe de tráfico + oficina.

---

## 7. Integraciones y APIs

**Hoy, para arrancar: NINGUNA es obligatoria.** El sistema es autónomo y habla solo con su propia
base de datos. Esto es deliberado — cero dependencias externas que puedan fallar el primer día.

Integraciones **opcionales / futuras** (cada una entra solo si la empresa la pide y aporta valor):

| Integración | Qué aporta | Estado | Qué haría falta de la empresa |
|---|---|---|---|
| **OSRM** (rutas) | km por carretera real + ETA (vs. estimación) | Infra propia, self-host; hay estimación de respaldo sin él | Nada — es infra nuestra |
| **TMS del cliente** | Importar/exportar viajes automáticamente | Futuro | Formato de export de su TMS (Excel/API/EDI) |
| **Tarjetas de combustible** (Solred/DKV/AS24…) | Repostajes reales imputados al viaje (P&L real) | Futuro | Acceso/API a su proveedor de tarjeta |
| **Tacógrafo (descarga remota)** | Horas 561 reales por chófer | Futuro | Su sistema de tacógrafo (VDO/Stoneridge) |
| **WhatsApp** | 2º canal chófer/cliente además de Telegram | Futuro (coste + rediseño del push) | Número verificado + alta con un proveedor (BSP) |

---

## 8. Legal / RGPD

- Norenty actúa como **encargado del tratamiento** (processor); la empresa cliente es el
  **responsable** (controller). Ver `PRIVACIDAD-*.md` (RAT, subprocesadores, DPA plantilla, ARCO).
- Para un **piloto con datos de prueba (inventados)**: no se tratan datos personales reales, así
  que no hay disparador de RGPD — se puede empezar sin trámite legal.
- Para **datos reales de chóferes** (nombres, licencias, ubicación): la empresa necesita el
  **consentimiento del chófer** y, si lo pide, firmar un **DPA** con Norenty. La consulta legal de
  cierre (revisión por abogado) está pendiente en el roadmap (ítem 9.11).

---

## 9. Checklist de arranque (para el gestor)

- [ ] Registrarse (crea la empresa automáticamente).
- [ ] Configurar la base de la empresa y el coste/km (Ajustes → Empresa) — opcional pero recomendado.
- [ ] Dar de alta al menos 1 vehículo (matrícula).
- [ ] Dar de alta al menos 1 chófer (nombre + idioma) y pasarle su enlace de Telegram.
- [ ] Crear el primer viaje (manual o importando un Excel).
- [ ] (Si va a meter datos reales de chóferes) tener su consentimiento RGPD.
- [ ] Invitar al resto del equipo si hace falta.
