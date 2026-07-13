# Revisión de diseño/UX del dashboard

**Nota de método:** esta revisión está hecha leyendo el código (componentes, `globals.css`,
patrones repetidos) tras haber trabajado en casi todos los módulos del dashboard esta sesión —
no es una revisión visual en pantalla. Intenté abrir el navegador para hacerlo con capturas
reales, pero no diste permiso de control del ordenador esa vez; si quieres una segunda pasada
con capturas de verdad, dilo y lo repito, o abre tú `localhost:3000` (el servidor de dev quedó
corriendo) y dime qué ves — esa combinación (mi lectura de código + tu ojo real) es más fiable
que cualquiera de las dos por separado.

---

## Lo que ya está bien

- **Sistema de diseño coherente**: paleta semántica clara (`estado-ok`/`estado-riesgo`/
  `estado-incidencia` para semáforo de estados, `brand`/`accent` para marca, escala de grises
  `ink`/`ink-secondary`/`ink-muted` para jerarquía de texto) definida una vez en `globals.css` y
  usada de forma consistente en absolutamente todos los componentes — nada de colores sueltos
  inventados página a página.
- **Patrón de error visible + reintentar** (9.35) consistente en toda la app — el usuario nunca
  se queda mirando una pantalla en blanco sin saber si está cargando, vacía, o rota.
- **Gateo por rol** (`RequireRol`) consistente — un `gestor_operativo`/`solo_lectura` no ve
  botones que no puede usar, en vez de verlos y que le fallen al pulsar.
- **Mobile**: menú hamburguesa + drawer, tablas con densidad de columnas alta resueltas con
  scroll horizontal contenido (no rompen el layout). Funcional, aunque ver el punto de abajo.

## Lo que preocupa de cara a "que mi abuela lo use"

1. **Texto demasiado pequeño por defecto.** La inmensa mayoría del contenido (tablas, labels de
   formulario, texto secundario) usa `text-xs` (12px) o `text-sm` (14px) — nunca un tamaño base
   más grande. Es una elección común en dashboards "para profesionales", pero es precisamente lo
   contrario de lo que pide alguien mayor o con baja visión. No hay ningún control de tamaño de
   letra ni modo "cómodo".

2. **Densidad de navegación.** El sidebar tiene 4 grupos colapsables (Operación, Maestros,
   Documentos, Análisis) + 2 enlaces sueltos (Hoy, Ajustes) = **12 destinos distintos** visibles
   de entrada. Para un usuario avanzado está bien organizado; para alguien que solo quiere "ver
   si mi camión ha llegado" es mucho para procesar en la primera pantalla que ve en su vida.

3. **Jerga sin explicar.** Términos como "561" (Reglamento CE 561/2006), "POD", "RLS", "estado
   planificado/en curso" aparecen en la UI sin un tooltip o "¿qué es esto?" — tiene sentido para
   quien ya sabe qué es un tacógrafo, no para un usuario nuevo sin ese vocabulario.

4. **Formularios largos con muchos campos numéricos opcionales** (p. ej. "Coste desglosado" en
   Ajustes: 4 campos €/l, €/km, €/noche, €/km más — todos a la vez, sin guiar cuál rellenar
   primero ni por qué). Intimidante para alguien no acostumbrado a hojas de cálculo de costes.

5. **Botones solo-icono en varios sitios** (papelera de "Quitar parada" en Presupuesto, X de
   cerrar el drawer móvil) — tamaño de icono pequeño (14-20px) para un objetivo táctil en móvil;
   el estándar de accesibilidad táctil recomienda mínimo ~44×44px de área pulsable, aquí el
   `padding` es generoso pero no está medido explícitamente contra ese mínimo.

6. **Sin onboarding.** Un usuario nuevo (uno de tus conocidos, en el piloto que estás
   planteando) entra directamente a una pantalla llena de datos y opciones, sin un recorrido
   guiado de "esto es lo primero que deberías hacer" (dar de alta un vehículo, un chófer, un
   viaje, en ese orden).

## Por qué esto conecta con "de ahí la importancia del asistente"

Tienes razón en la intuición: la forma más barata de resolver 3 y 6 (jerga sin explicar +
falta de onboarding) **no es rediseñar cada pantalla**, es tener alguien/algo a quien
preguntarle "¿qué significa esto?" o "¿cómo doy de alta un vehículo?" en lenguaje normal — que
es exactamente lo que `12.4 Asistente chat / "IA Brain"` ya tenía anotado en el roadmap como
DEFERIDO a propósito (esperando datos de uso reales + el `contexto` de Fase 11). El diseño
visual y el asistente no son alternativas, son complementarios: un dashboard más simple
necesita menos asistente; un asistente bueno perdona un dashboard más denso. Probablemente el
orden correcto sea: simplificar lo barato AHORA (abajo) y dejar que el asistente absorba lo que
quede, en vez de rediseñar todo el dashboard desde cero antes de tener usuarios reales.

## Recomendaciones, de más a menos barato

1. **Subir el tamaño de texto por defecto** en el contenido principal (no en tablas densas
   necesariamente, pero sí en labels, botones y texto de página) de `text-xs`/`text-sm` a
   `text-sm`/`text-base` donde no rompa el layout. Cambio de CSS, bajo riesgo, alto impacto.
2. **Tooltips o "?" con explicación breve** en los 4-5 términos de jerga más repetidos (561,
   POD, RLS/aislamiento — este seguramente ni debería verlo un gestor, noches fuera). Componente
   reutilizable pequeño, bajo riesgo.
3. **Checklist de "primeros pasos"** en la home (`/`) para empresas nuevas sin datos todavía:
   "1. Da de alta un vehículo → 2. Da de alta un chófer → 3. Crea tu primer viaje" con enlaces
   directos — desaparece sola cuando ya hay datos. Encaja bien con el piloto de amigos que estás
   planteando en `DEPLOY-PLAN.md`.
4. **Colapsar por defecto los grupos avanzados** (Documentos, Análisis) para cuentas nuevas sin
   histórico, dejando expandido solo "Operación" — hoy todo empieza expandido para todo el
   mundo.
5. **Revisar campos táctiles pequeños en móvil** (medir contra 44×44px) — cambio de CSS
   puntual, no de arquitectura.

## Lo que NO haría todavía

- Un rediseño visual completo (nueva paleta, nueva tipografía) — el sistema actual es coherente
  y funciona; el problema no es "es feo", es "es denso para un principiante".
- Un modo "simple" separado con su propia navegación — antes de construir dos interfaces
  paralelas, mejor ver con el piloto real (tus conocidos) si el problema es tan grave como para
  justificarlo, o si el checklist + tooltips ya lo resuelven.
- Cualquier cosa que dependa del asistente de chat — sigue deferido a propósito hasta tener
  datos de uso reales (Fase 11 `contexto` + volumen del piloto).

## Siguiente paso sugerido

Si quieres, hago las recomendaciones 1-2-4 ahora (son las tres más baratas y no necesitan
ninguna decisión tuya) y dejamos 3 (checklist de primeros pasos) para cuando tengas el piloto
de `DEPLOY-PLAN.md` más definido, ya que su contenido exacto depende de en qué orden quieres que
la gente use el sistema la primera vez.
