// Diccionarios de estado/tipo unificados (ítem 7A.12). Antes de este archivo,
// varios de estos vivían duplicados en 2-3 páginas (ESTADO_VIAJE en viajes/page,
// viajes/[id] y choferes/[id]; TIPO_DOC_LABEL en documentos/page y
// NotificationCenter; TIPOS_PARKING en mapa/page y MapView; LABEL_CAPA en
// viajes/[id] y presupuesto/page) — cualquier cambio de texto había que
// replicarlo a mano en cada sitio, con riesgo real de que se desincronizaran.
// Este archivo es la única fuente de verdad; mismos valores exactos que antes,
// cero cambio de comportamiento.

export const ESTADO_VIAJE = {
  planificado: { t: "Planificado", c: "text-estado-planificado", bg: "bg-blue-50" },
  en_curso: { t: "En curso", c: "text-estado-en-curso", bg: "bg-indigo-50" },
  completado: { t: "Completado", c: "text-estado-ok", bg: "bg-green-50" },
  cancelado: { t: "Cancelado", c: "text-ink-muted", bg: "bg-gray-100" },
};

export const ESTADO_HITO = {
  pendiente: { label: "Pendiente", color: "text-ink-muted" },
  en_curso: { label: "En curso", color: "text-estado-en-curso" },
  completado: { label: "Completado", color: "text-estado-ok" },
  fallido: { label: "Fallido", color: "text-estado-incidencia" },
};

export const ESTADO_POD = {
  pendiente: { label: "Sin validar", color: "bg-gray-100 text-ink-secondary" },
  valido: { label: "Válido", color: "bg-green-50 text-estado-ok" },
  invalido: { label: "Inválido", color: "bg-red-50 text-estado-incidencia" },
  dudoso: { label: "Dudoso", color: "bg-orange-50 text-estado-riesgo" },
};

export const ESTADO_INCIDENCIA = {
  abierta: { label: "Abierta", color: "text-estado-incidencia", bg: "bg-red-50" },
  en_revision: { label: "En revisión", color: "text-yellow-600", bg: "bg-yellow-50" },
  resuelta: { label: "Resuelta", color: "text-estado-ok", bg: "bg-green-50" },
};

export const TIPO_INCIDENCIA_LABEL = {
  fuera_de_ventana: "Fuera de ventana",
  rechazo_entrega: "Rechazo en entrega",
  documento_invalido: "Documento inválido",
  averia: "Avería",
  accidente: "Accidente",
  retraso: "Retraso",
  otro: "Otro",
};

export const TIPOS_DOC_VIAJE = [
  { value: "cmr", label: "CMR / Carta de porte" },
  { value: "albaran", label: "Albarán" },
  { value: "adr", label: "ADR (mercancía peligrosa)" },
  { value: "otro", label: "Otro" },
];

export const TIPOS_DOC_VEHICULO = [
  { value: "itv", label: "ITV" },
  { value: "seguro", label: "Seguro" },
  { value: "autorizacion_transporte", label: "Autorización de transporte" },
  { value: "otro", label: "Otro" },
];

export const TIPOS_DOC_CHOFER = [
  { value: "licencia", label: "Licencia de conducir" },
  { value: "cap", label: "CAP" },
  { value: "otro", label: "Otro" },
];

// Etiquetas de TODOS los tipos de documento (viaje+vehículo+chófer juntos) —
// para sitios que muestran documentos de cualquier ámbito (documentos/page,
// NotificationCenter) sin necesitar saber a qué ámbito pertenece cada tipo.
export const TIPO_DOC_LABEL = {
  cmr: "CMR / Carta de porte",
  albaran: "Albarán",
  adr: "ADR",
  itv: "ITV",
  seguro: "Seguro",
  autorizacion_transporte: "Autorización de transporte",
  licencia: "Licencia de conducir",
  cap: "CAP",
  otro: "Otro",
};

export const AMBITO_LABEL = { viaje: "Viaje", vehiculo: "Vehículo", chofer: "Chófer" };

export const TIPOS_PARKING = [
  { value: "parking", label: "Parking" },
  { value: "fueling", label: "Gasolinera / Truck stop" },
  { value: "rest_area", label: "Área de descanso" },
  { value: "otro", label: "Otro" },
];

export const TIPO_PARKING_LABEL = {
  parking: "Parking",
  fueling: "Gasolinera / Truck stop",
  rest_area: "Área de descanso",
  otro: "Otro",
};

export const TIPO_GASTO_LABEL = {
  repostaje: "Repostaje", peaje: "Peaje", multa: "Multa", dieta: "Dieta", otro: "Otro",
};

export const TIPOS_VEHICULO = [
  { value: "tractora", label: "Tractora" },
  { value: "remolque", label: "Remolque" },
  { value: "rigido", label: "Rígido" },
  { value: "furgoneta", label: "Furgoneta" },
];

export const TIPO_MANTENIMIENTO_LABEL = {
  itv: { label: "ITV", color: "text-blue-600", bg: "bg-blue-50" },
  revision: { label: "Revisión", color: "text-indigo-600", bg: "bg-indigo-50" },
  averia: { label: "Avería", color: "text-estado-incidencia", bg: "bg-red-50" },
  reparacion: { label: "Reparación", color: "text-yellow-600", bg: "bg-yellow-50" },
  otro: { label: "Otro", color: "text-ink-secondary", bg: "bg-surface-alt" },
};

export const ESTADO_MANTENIMIENTO_CHIP = {
  completado: "bg-green-50 text-estado-ok",
  pendiente: "bg-yellow-50 text-yellow-700",
};

export const IDIOMA_LABEL = { es: "ES", ro: "RO", ar: "AR", fr: "FR", it: "IT", en: "EN", pt: "PT", de: "DE" };

// Capas de coste desglosado (7A.5/7A.6/7A.8)
export const LABEL_CAPA = { combustible: "Combustible", conductor: "Conductor", peajes: "Peajes", dietas: "Dietas" };
