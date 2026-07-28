"""Norenty Telegram Bot — operación de hitos, POD, y alertas al gestor."""

import asyncio
from datetime import datetime, timezone
import hashlib
import json
import math
import os
import logging
import re
import time
import uuid
from urllib.parse import quote_plus

import httpx
import sentry_sdk

if _dsn := os.environ.get("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=_dsn,
        traces_sample_rate=0.1,
        environment=os.environ.get("ENVIRONMENT", "production"),
    )
    logging.getLogger("norenty.bot").info("Sentry inicializado")
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    ApplicationHandlerStop,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    TypeHandler,
    filters,
    ContextTypes,
)
from . import cola
from .db import supabase

# Campos propios de LogRecord (ítem 9.5): cualquier clave que NO esté aquí y
# se pase por `extra={...}` se vuelca tal cual al JSON de salida. Así
# empresa_id/viaje_id/chofer_id/update_id (o lo que sea relevante en cada
# línea) queda buscable sin depender de parsear texto libre — el objetivo es
# poder responder en minutos a "ayer a las 18:40 no me llegó la alerta".
_LOG_RECORD_RESERVADOS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename", "module",
    "exc_info", "exc_text", "stack_info", "lineno", "funcName", "created", "msecs",
    "relativeCreated", "thread", "threadName", "processName", "process", "message", "taskName",
}


class JsonFormatter(logging.Formatter):
    def format(self, record):
        base = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _LOG_RECORD_RESERVADOS and not key.startswith("_"):
                base[key] = value
        if record.exc_info:
            base["exception"] = self.formatException(record.exc_info)
        # default=str: nunca debe reventar el logging por un objeto no serializable
        # (UUID, excepción, etc.) — un logger que lanza es peor que uno impreciso.
        return json.dumps(base, default=str, ensure_ascii=False)


_handler = logging.StreamHandler()
_handler.setFormatter(JsonFormatter())
logging.basicConfig(level=logging.INFO, handlers=[_handler])
logger = logging.getLogger("norenty.bot")

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]

# Errores de red/timeout que SÍ tiene sentido reintentar (un blip transitorio
# puede resolverse solo). Deliberadamente NO se incluyen errores de
# validación/lógica (esos fallarán igual en el reintento nº2 que en el nº1).
_ERRORES_REINTENTABLES = (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError)


def ejecutar_con_reintentos(fn, *, intentos=3, backoff_base=0.5, contexto=None):
    """Ejecuta `fn()` (una llamada a Supabase) con reintentos y backoff
    exponencial (0.5s, 1s) ante errores de red/timeout (ítem 8.2 — "el canal
    con el chófer nunca se cae en silencio"). Si tras `intentos` sigue
    fallando, lo manda a Sentry con `contexto` (acción, chofer_id, hito_id...)
    y relanza — el llamador decide qué hacer (normalmente, disculparse con el
    chófer vía el error handler global de PTB, no aquí).
    """
    ultimo_error = None
    for intento in range(intentos):
        try:
            return fn()
        except _ERRORES_REINTENTABLES as e:
            ultimo_error = e
            logger.warning(
                "Intento %d/%d falló (%s): %s", intento + 1, intentos, contexto, e,
                extra={**(contexto or {}), "intento": intento + 1, "intentos_totales": intentos},
            )
            if intento < intentos - 1:
                time.sleep(backoff_base * (2 ** intento))

    if os.environ.get("SENTRY_DSN"):
        with sentry_sdk.push_scope() as scope:
            for k, v in (contexto or {}).items():
                scope.set_tag(k, v)
            sentry_sdk.capture_exception(ultimo_error)
    raise ultimo_error


# --- Endurecimiento del perímetro (ítem 9.9) ---
# Dos guardas registradas como handlers de máxima prioridad (group=-1, ver
# create_bot_app): corren ANTES que cualquier comando/callback/mensaje real y,
# si detectan un problema, cortan con ApplicationHandlerStop — el resto de
# grupos (los handlers "de verdad") ni se ejecutan para ese update. Cubren
# TODOS los tipos de update (mensaje, callback_query, ubicación...) porque se
# registran con TypeHandler(Update, ...), no con un filtro de mensaje.

# 1) Dedupe por update_id: Telegram reintenta la entrega si el bot tarda en
#    responder (timeout de su lado), reenviando el MISMO update_id. Sin esto,
#    un reintento duplicaría ejecucion_evento (dos "llegada" para el mismo
#    hito). FIFO simple en memoria — un proceso solo, sin necesidad de tabla.
_MAX_UPDATE_IDS_RECORDADOS = 2000
_update_ids_vistos: set[int] = set()
_update_ids_orden: list[int] = []


def _update_ya_procesado(update_id: int) -> bool:
    if update_id in _update_ids_vistos:
        return True
    _update_ids_vistos.add(update_id)
    _update_ids_orden.append(update_id)
    if len(_update_ids_orden) > _MAX_UPDATE_IDS_RECORDADOS:
        mas_viejo = _update_ids_orden.pop(0)
        _update_ids_vistos.discard(mas_viejo)
    return False


async def descartar_update_duplicado(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.update_id is not None and _update_ya_procesado(update.update_id):
        logger.warning("Update duplicado descartado: %s", update.update_id, extra={"update_id": update.update_id})
        raise ApplicationHandlerStop


# 2) Rate limiting por chat_id: ventana deslizante en memoria, anti-flood
#    (un chófer con el bot enloquecido, o un tercero abusando de un chat_id
#    filtrado, no debe poder inundar de comandos/callbacks).
RATE_LIMIT_VENTANA_S = 10
RATE_LIMIT_MAX_UPDATES = 15
_historial_por_chat: dict[str, list[float]] = {}


def _rate_limit_excedido(chat_id: str) -> bool:
    ahora = time.monotonic()
    historial = _historial_por_chat.setdefault(chat_id, [])
    historial[:] = [t for t in historial if ahora - t < RATE_LIMIT_VENTANA_S]
    historial.append(ahora)
    return len(historial) > RATE_LIMIT_MAX_UPDATES


async def limitar_flujo(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat
    if chat is None:
        return
    if _rate_limit_excedido(str(chat.id)):
        logger.warning("Rate limit excedido para chat_id=%s", chat.id, extra={"chat_id": chat.id, "update_id": update.update_id})
        raise ApplicationHandlerStop


# 3) Validación de fotos de POD antes de subir: Telegram ya comprime/limita
#    las fotos de tipo "photo", pero se valida igual tamaño y firma de
#    fichero (magic bytes JPEG) por defensa en profundidad — nunca confiar
#    ciegamente en el tipo de contenido que dice el cliente.
POD_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
POD_JPEG_MAGIC = b"\xff\xd8\xff"

# Fase 23, Bloque A (23.A.1) -- DISCOVERY.md insight 14: "Hay muchos fallos en
# la foto del albarán... no se lee ninguna letra." Una foto ilegible rompe la
# cadena de evidencia y no se detecta hasta días después, con el chófer a
# 500 km. Estos umbrales validan CALIDAD (nitidez/luz/resolución), no solo
# formato -- valores iniciales razonables, NO pactados con cliente real,
# mismo estatus que el resto de umbrales del proyecto.
POD_RESOLUCION_MIN_PX = 300  # por debajo de esto, ilegible aunque esté enfocada
POD_LUMINOSIDAD_MIN = 25   # 0-255; por debajo, prácticamente negra
POD_LUMINOSIDAD_MAX = 235  # por encima, quemada por flash/sol directo
POD_NITIDEZ_MIN = 20.0     # varianza del filtro de bordes; por debajo, movida/desenfocada.
# Calibrado con un tablero de ajedrez sintético (test_bot.py): nítido ~54,
# con desenfoque gaussiano fuerte (radius=12) ~10 -- 20 deja margen claro
# entre ambos sin ser tan alto que rechace fotos reales con menos contraste
# que un tablero de ajedrez. Ajustar con fotos reales del primer piloto.

try:
    from PIL import Image, ImageFilter, ImageStat
    _PIL_DISPONIBLE = True
except ImportError:  # Pillow es opcional: sin ella, se degrada a solo formato/tamaño.
    _PIL_DISPONIBLE = False


def _calidad_foto_pod(datos: bytes):
    """Analiza nitidez/luz/resolución con Pillow. Devuelve None si Pillow no
    está disponible o la imagen no se puede abrir (nunca lanza -- ante la
    duda de si PODEMOS analizarla, se acepta la foto en vez de rechazarla;
    rechazar una foto buena cuesta más que aceptar una regular, ver ROADMAP
    23.A.1). Si devuelve dict, siempre trae las tres métricas."""
    if not _PIL_DISPONIBLE:
        return None
    try:
        import io
        with Image.open(io.BytesIO(bytes(datos))) as img:
            ancho, alto = img.size
            gris = img.convert("L")
            luminosidad = ImageStat.Stat(gris).mean[0]
            bordes = gris.filter(ImageFilter.FIND_EDGES)
            nitidez = ImageStat.Stat(bordes).stddev[0]
            return {"ancho": ancho, "alto": alto, "luminosidad": luminosidad, "nitidez": nitidez}
    except Exception:
        return None


def _foto_pod_valida(datos: bytes):
    """Devuelve (valida: bool, motivo: str|None). `motivo` es la clave de
    TEXTOS a mostrar al chófer (None si es válida). Los checks de formato
    (tamaño/magic bytes) son estructurales y no negociables; los de calidad
    (nitidez/luz/resolución) son best-effort vía Pillow y SIEMPRE aceptan si
    hay cualquier duda -- un falso rechazo (foto buena marcada como mala)
    cuesta más en adopción que un falso positivo (foto regular aceptada)."""
    if len(datos) > POD_MAX_BYTES or bytes(datos[:3]) != POD_JPEG_MAGIC:
        return False, "foto_invalida"

    calidad = _calidad_foto_pod(datos)
    if calidad is None:
        return True, None
    if calidad["ancho"] < POD_RESOLUCION_MIN_PX or calidad["alto"] < POD_RESOLUCION_MIN_PX:
        return False, "foto_pequena"
    if calidad["luminosidad"] < POD_LUMINOSIDAD_MIN:
        return False, "foto_oscura"
    if calidad["luminosidad"] > POD_LUMINOSIDAD_MAX:
        return False, "foto_quemada"
    if calidad["nitidez"] < POD_NITIDEZ_MIN:
        return False, "foto_borrosa"
    return True, None


# --- i18n ---
TEXTOS = {
    "es": {
        "sin_viaje_activo": "No tienes ningún viaje activo.",
        "viaje_completado": "Viaje {ref} completado — {total}/{total} hitos.\n\nBuen trabajo.",
        "resumen_ruta": "📊 Resumen de tu ruta: {paradas} paradas · {km} km · {horas} h de conducción (estimado).",
        "resumen_ruta_sin_datos": "📊 {paradas} paradas completadas. Sin datos de GPS suficientes para estimar km/horas de esta ruta.",
        "pulsa_llegada": "Pulsa cuando llegues al punto.",
        "btn_llegado": "He llegado",
        "no_vinculado": "No estás vinculado. Usa /start TU_CODIGO primero.",
        "hito_recogida": "RECOGIDA",
        "hito_entrega": "ENTREGA",
        "hito_sin_dir": "sin dirección",
        "hito_ventana": "Ventana",
        "confirmar_llegada": "¿Confirmas que has llegado a la {tipo} en {dir}?",
        "btn_confirmar": "Sí, confirmo",
        "btn_cancelar": "No, cancelar",
        "cancelado": "Cancelado. Pulsa cuando llegues de verdad.",
        "pedir_foto": "Llegada registrada en {dir}.\n\nAhora necesito la FOTO DEL ALBARÁN.\nMándame la foto por aquí.",
        "btn_sin_foto": "No la tengo ahora",
        "sin_pod_ok": "Entrega registrada en {dir} sin foto de albarán.\nAvisado tu gestor para que lo revise cuando pueda.",
        "recogida_ok": "Recogida completada en {dir}.",
        "entrega_ok": "Entrega completada en {dir}.",
        "aviso_pausa_561": "🕐 Llevas cerca de 4,5 h de conducción — te toca una pausa de 45 min.",
        "foto_subiendo": "Recibida. Subiendo foto...",
        "sin_entrega_esperando": "No hay ninguna entrega esperando albarán.\nUsa /estado para ver tu siguiente hito.",
        "pod_ok": "Albarán recibido para {dir}.\nEntrega completada.",
        "foto_invalida": "Esa foto no parece válida. Mándame una foto normal del albarán (no un fichero ni un vídeo).",
        "foto_borrosa": "Se ve movida y no se lee bien. Mándame otra foto del albarán, parado y con buena luz.",
        "foto_oscura": "Se ve muy oscura y no se lee. Mándame otra foto del albarán con más luz.",
        "foto_quemada": "Se ve quemada por el flash o el sol. Mándame otra foto del albarán sin flash directo.",
        "foto_pequena": "La foto es muy pequeña para leerse bien. Mándame otra foto del albarán más de cerca.",
        "anot_pregunta": "¿Todo bien con la mercancía entregada?",
        "btn_anot_mojada": "💧 Llega mojada",
        "btn_anot_danada": "📦 Llega dañada",
        "btn_anot_faltan": "❗ Faltan bultos",
        "btn_anot_sello": "🖊️ Sello/firma ilegible",
        "btn_anot_bien": "✅ Todo bien",
        "anot_registrada": "Anotado. Gracias.",
        "incidencia_ayuda": "Cuéntame qué ha pasado: mándame una nota de voz 🎤 o escríbelo aquí.",
        "inc_elige": "¿Qué ha pasado?",
        "btn_inc_averia": "🔧 Avería",
        "btn_inc_retraso": "⏱️ Voy con retraso",
        "btn_inc_carga": "📦 Problema carga/descarga",
        "btn_inc_otra": "🎤 Otra cosa",
        "inc_desc_averia": "Avería del vehículo",
        "inc_desc_retraso": "Retraso en la ruta",
        "inc_desc_carga": "Problema en carga o descarga",
        "inc_otra_prompt": "Cuéntame qué ha pasado: mándame una nota de voz 🎤 o escríbelo en un mensaje.",
        "incidencia_ok": "Incidencia reportada para viaje {ref}. Tu gestor ha sido notificado.",
        "incidencia_foto_pregunta": "Si quieres, mándame una foto ahora (opcional).",
        "incidencia_foto_ok": "Foto adjuntada a la incidencia.",
        "nota_voz_ok": "Nota de voz guardada en el viaje. Tu gestor la escuchará.",
        "nota_voz_sin_viaje": "No tienes ningún viaje en curso al que adjuntar la nota de voz.",
        "btn_incidencia": "📍 Reportar incidencia",
        "btn_mi_viaje": "📋 Mi viaje",
        "btn_contactar": "📞 Contactar gestor",
        "menu_recordatorio": "Usa los botones de abajo cuando lo necesites 👇",
        "contactar_info": "Tu gestor es {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Tu gestor es {nombre}.\nTodavía no ha configurado un contacto directo.",
        "contactar_sin_gestor": "Tu gestor aún no ha configurado contacto. Prueba con /incidencia si es urgente.",
        "contactar_prompt": "Escríbeme el mensaje o mándame una nota de voz 🎤 — le llega a tu gestor al momento.",
        "btn_llamar": "📞 Llamada urgente",
        "mensaje_gestor_ok": "Mensaje enviado a tu gestor.",
        "parking_titulo": "📍 Parkings cercanos:",
        "parking_sin_ubicacion": "No tengo tu ubicación todavía. Confirma la llegada a un hito o comparte tu ubicación por Telegram.",
        "parking_sin_resultados": "No encontré parkings cercanos.",
        "parking_sin_resultados_radio": "No hay parkings dentro de lo que puedes conducir antes de la próxima pausa obligatoria.",
        "parking_radio_disponible": "Puedes conducir hasta ~{km} km antes de la próxima pausa obligatoria.",
        "parking_tipo_parking": "Parking",
        "parking_tipo_fueling": "Gasolinera / Truck stop",
        "parking_tipo_rest_area": "Área de descanso",
        "parking_tipo_otro": "Otro",
        "btn_como_llegar": "Cómo llegar",
        "eta_titulo": "🕐 Tiempo estimado restante:",
        "eta_sin_hitos": "No tengo suficientes datos de ruta para calcular el tiempo restante.",
        "eta_conduccion": "{km} km a {velocidad} km/h → {horas} h de conducción",
        "eta_parada": "parada de 45 min",
        "eta_paradas": "paradas de 45 min",
        "eta_descanso": "descanso de 11h",
        "eta_descansos": "descansos de 11h",
        "eta_sin_paradas": "Sin paradas obligatorias en el resto de la ruta.",
        "eta_total": "Total: {horas} h",
        "asignacion_titulo": "🚚 Se te ha asignado el viaje {ref}",
        "asignacion_detalle": "{n} paradas · ~{km} km\nPrimera parada: {dir}",
        "geo_llegada_pregunta": "📍 Parece que has llegado a {dir}. ¿Confirmas?",
        "error_tecnico": "⚠️ Estamos teniendo un problema técnico. Por favor, inténtalo de nuevo en un minuto.",
    },
    "en": {
        "sin_viaje_activo": "You have no active trip.",
        "viaje_completado": "Trip {ref} completed — {total}/{total} stops.\n\nWell done!",
        "resumen_ruta": "📊 Route summary: {paradas} stops · {km} km · {horas} h driving (estimated).",
        "resumen_ruta_sin_datos": "📊 {paradas} stops completed. Not enough GPS data to estimate km/hours for this route.",
        "pulsa_llegada": "Tap when you arrive at the location.",
        "btn_llegado": "I've arrived",
        "no_vinculado": "You are not linked. Use /start YOUR_CODE first.",
        "hito_recogida": "PICKUP",
        "hito_entrega": "DELIVERY",
        "hito_sin_dir": "no address",
        "hito_ventana": "Window",
        "confirmar_llegada": "Confirm arrival at {tipo} — {dir}?",
        "btn_confirmar": "Yes, confirm",
        "btn_cancelar": "No, cancel",
        "cancelado": "Cancelled. Tap when you actually arrive.",
        "pedir_foto": "Arrival recorded at {dir}.\n\nNow I need the PROOF OF DELIVERY PHOTO.\nSend me the photo here.",
        "btn_sin_foto": "I don't have it now",
        "sin_pod_ok": "Delivery recorded at {dir} without a proof-of-delivery photo.\nYour manager has been notified to follow up.",
        "recogida_ok": "Pickup completed at {dir}.",
        "entrega_ok": "Delivery completed at {dir}.",
        "aviso_pausa_561": "🕐 You've been driving for about 4.5 h — time for a 45-min break.",
        "foto_subiendo": "Received. Uploading...",
        "sin_entrega_esperando": "No delivery is waiting for a proof of delivery.\nUse /estado to see your next stop.",
        "pod_ok": "Proof of delivery received for {dir}.\nDelivery completed.",
        "foto_invalida": "That photo doesn't look valid. Send me a normal photo of the proof of delivery (not a file or a video).",
        "foto_borrosa": "It looks blurry and hard to read. Send me another photo of the proof of delivery, steady and with good light.",
        "foto_oscura": "It looks too dark to read. Send me another photo of the proof of delivery with more light.",
        "foto_quemada": "It looks washed out by flash or sunlight. Send me another photo without direct flash.",
        "foto_pequena": "The photo is too small to read clearly. Send me another photo closer up.",
        "anot_pregunta": "Is everything OK with the delivered goods?",
        "btn_anot_mojada": "💧 Arrived wet",
        "btn_anot_danada": "📦 Arrived damaged",
        "btn_anot_faltan": "❗ Missing packages",
        "btn_anot_sello": "🖊️ Illegible stamp/signature",
        "btn_anot_bien": "✅ All good",
        "anot_registrada": "Noted. Thanks.",
        "incidencia_ayuda": "Tell me what happened: send me a voice note 🎤 or type it here.",
        "inc_elige": "What happened?",
        "btn_inc_averia": "🔧 Breakdown",
        "btn_inc_retraso": "⏱️ Running late",
        "btn_inc_carga": "📦 Loading/unloading issue",
        "btn_inc_otra": "🎤 Something else",
        "inc_desc_averia": "Vehicle breakdown",
        "inc_desc_retraso": "Delay on the route",
        "inc_desc_carga": "Problem loading or unloading",
        "inc_otra_prompt": "Tell me what happened: send me a voice note 🎤 or type it in a message.",
        "incidencia_ok": "Incident reported for trip {ref}. Your manager has been notified.",
        "incidencia_foto_pregunta": "If you want, send me a photo now (optional).",
        "incidencia_foto_ok": "Photo attached to the incident.",
        "nota_voz_ok": "Voice note saved to the trip. Your manager will listen to it.",
        "nota_voz_sin_viaje": "You have no trip in progress to attach the voice note to.",
        "btn_incidencia": "📍 Report incident",
        "btn_mi_viaje": "📋 My trip",
        "btn_contactar": "📞 Contact manager",
        "menu_recordatorio": "Use the buttons below whenever you need them 👇",
        "contactar_info": "Your manager is {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Your manager is {nombre}.\nNo direct contact configured yet.",
        "contactar_sin_gestor": "Your manager hasn't configured contact info yet. Try /incidencia if it's urgent.",
        "contactar_prompt": "Type your message or send me a voice note 🎤 — it reaches your manager right away.",
        "btn_llamar": "📞 Urgent call",
        "mensaje_gestor_ok": "Message sent to your manager.",
        "parking_titulo": "📍 Nearby parkings:",
        "parking_sin_ubicacion": "I don't have your location yet. Confirm arrival at a stop or share your location on Telegram.",
        "parking_sin_resultados": "No nearby parkings found.",
        "parking_sin_resultados_radio": "No parkings within reach before your next mandatory break.",
        "parking_radio_disponible": "You can drive up to ~{km} km before your next mandatory break.",
        "parking_tipo_parking": "Parking",
        "parking_tipo_fueling": "Fueling station / Truck stop",
        "parking_tipo_rest_area": "Rest area",
        "parking_tipo_otro": "Other",
        "btn_como_llegar": "Directions",
        "eta_titulo": "🕐 Estimated remaining time:",
        "eta_sin_hitos": "Not enough route data to calculate the remaining time.",
        "eta_conduccion": "{km} km at {velocidad} km/h → {horas} h driving",
        "eta_parada": "45-min break",
        "eta_paradas": "45-min breaks",
        "eta_descanso": "11h rest",
        "eta_descansos": "11h rests",
        "eta_sin_paradas": "No mandatory stops on the rest of the route.",
        "eta_total": "Total: {horas} h",
        "asignacion_titulo": "🚚 Trip {ref} has been assigned to you",
        "asignacion_detalle": "{n} stops · ~{km} km\nFirst stop: {dir}",
        "geo_llegada_pregunta": "📍 Looks like you've arrived at {dir}. Confirm?",
        "error_tecnico": "⚠️ We're having a technical problem. Please try again in a minute.",
    },
    "ro": {
        "sin_viaje_activo": "Nu ai nicio cursă activă.",
        "viaje_completado": "Cursa {ref} finalizată — {total}/{total} opriri.\n\nBravo!",
        "resumen_ruta": "📊 Rezumatul cursei: {paradas} opriri · {km} km · {horas} h de condus (estimat).",
        "resumen_ruta_sin_datos": "📊 {paradas} opriri finalizate. Date GPS insuficiente pentru a estima km/orele acestei curse.",
        "pulsa_llegada": "Apasă când ajungi la destinație.",
        "btn_llegado": "Am ajuns",
        "no_vinculado": "Nu ești conectat. Folosește /start CODUL_TĂU mai întâi.",
        "hito_recogida": "RIDICARE",
        "hito_entrega": "LIVRARE",
        "hito_sin_dir": "fără adresă",
        "hito_ventana": "Fereastră",
        "confirmar_llegada": "Confirmi că ai ajuns la {tipo} în {dir}?",
        "btn_confirmar": "Da, confirm",
        "btn_cancelar": "Nu, anulează",
        "cancelado": "Anulat. Apasă când ajungi cu adevărat.",
        "pedir_foto": "Sosire înregistrată la {dir}.\n\nAcum am nevoie de FOTOGRAFIA DOCUMENTULUI.\nTrimite-mi fotografia aici.",
        "btn_sin_foto": "Nu o am acum",
        "sin_pod_ok": "Livrare înregistrată la {dir} fără fotografia documentului.\nManagerul tău a fost anunțat să verifice.",
        "recogida_ok": "Ridicare finalizată la {dir}.",
        "entrega_ok": "Livrare finalizată la {dir}.",
        "aviso_pausa_561": "🕐 Conduci de aproape 4,5 h — e timpul pentru o pauză de 45 min.",
        "foto_subiendo": "Primit. Se încarcă...",
        "sin_entrega_esperando": "Nicio livrare nu așteaptă document.\nFolosește /estado pentru a vedea următoarea oprire.",
        "pod_ok": "Document primit pentru {dir}.\nLivrare finalizată.",
        "foto_invalida": "Fotografia nu pare validă. Trimite-mi o fotografie normală a documentului (nu un fișier sau un videoclip).",
        "foto_borrosa": "Este neclară și greu de citit. Trimite-mi altă fotografie a documentului, stabilă și cu lumină bună.",
        "foto_oscura": "Este prea întunecată pentru a fi citită. Trimite-mi altă fotografie cu mai multă lumină.",
        "foto_quemada": "Este supraexpusă de blitz sau soare. Trimite-mi altă fotografie fără blitz direct.",
        "foto_pequena": "Fotografia este prea mică pentru a fi citită clar. Trimite-mi altă fotografie mai aproape.",
        "anot_pregunta": "Totul e în regulă cu marfa livrată?",
        "btn_anot_mojada": "💧 Ajunge udă",
        "btn_anot_danada": "📦 Ajunge deteriorată",
        "btn_anot_faltan": "❗ Lipsesc colete",
        "btn_anot_sello": "🖊️ Ștampilă/semnătură ilizibilă",
        "btn_anot_bien": "✅ Totul e bine",
        "anot_registrada": "Notat. Mulțumesc.",
        "incidencia_ayuda": "Spune-mi ce s-a întâmplat: trimite-mi o notă vocală 🎤 sau scrie aici.",
        "inc_elige": "Ce s-a întâmplat?",
        "btn_inc_averia": "🔧 Defecțiune",
        "btn_inc_retraso": "⏱️ Am întârziere",
        "btn_inc_carga": "📦 Problemă la încărcare/descărcare",
        "btn_inc_otra": "🎤 Altceva",
        "inc_desc_averia": "Defecțiune a vehiculului",
        "inc_desc_retraso": "Întârziere pe traseu",
        "inc_desc_carga": "Problemă la încărcare sau descărcare",
        "inc_otra_prompt": "Spune-mi ce s-a întâmplat: trimite-mi o notă vocală 🎤 sau scrie într-un mesaj.",
        "incidencia_ok": "Incident raportat pentru cursa {ref}. Managerul tău a fost notificat.",
        "incidencia_foto_pregunta": "Dacă vrei, trimite-mi o poză acum (opțional).",
        "incidencia_foto_ok": "Poză atașată incidentului.",
        "nota_voz_ok": "Nota vocală a fost salvată în cursă. Managerul tău o va asculta.",
        "nota_voz_sin_viaje": "Nu ai nicio cursă în desfășurare la care să atașezi nota vocală.",
        "btn_incidencia": "📍 Raportează un incident",
        "btn_mi_viaje": "📋 Cursa mea",
        "btn_contactar": "📞 Contactează managerul",
        "menu_recordatorio": "Folosește butoanele de mai jos când ai nevoie 👇",
        "contactar_info": "Managerul tău este {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Managerul tău este {nombre}.\nNu a configurat încă un contact direct.",
        "contactar_sin_gestor": "Managerul tău nu a configurat încă datele de contact. Încearcă /incidencia dacă este urgent.",
        "contactar_prompt": "Scrie-mi mesajul sau trimite-mi o notă vocală 🎤 — ajunge imediat la managerul tău.",
        "btn_llamar": "📞 Apel urgent",
        "mensaje_gestor_ok": "Mesaj trimis managerului tău.",
        "parking_titulo": "📍 Parcări din apropiere:",
        "parking_sin_ubicacion": "Nu am încă locația ta. Confirmă sosirea la o oprire sau distribuie locația pe Telegram.",
        "parking_sin_resultados": "Nu am găsit parcări în apropiere.",
        "parking_sin_resultados_radio": "Nu există parcări la care poți ajunge înainte de următoarea pauză obligatorie.",
        "parking_radio_disponible": "Poți conduce până la ~{km} km înainte de următoarea pauză obligatorie.",
        "parking_tipo_parking": "Parcare",
        "parking_tipo_fueling": "Benzinărie / Truck stop",
        "parking_tipo_rest_area": "Zonă de odihnă",
        "parking_tipo_otro": "Altul",
        "btn_como_llegar": "Direcții",
        "eta_titulo": "🕐 Timp estimat rămas:",
        "eta_sin_hitos": "Nu am suficiente date despre traseu pentru a calcula timpul rămas.",
        "eta_conduccion": "{km} km la {velocidad} km/h → {horas} h de condus",
        "eta_parada": "pauză de 45 min",
        "eta_paradas": "pauze de 45 min",
        "eta_descanso": "repaus de 11h",
        "eta_descansos": "repausuri de 11h",
        "eta_sin_paradas": "Fără opriri obligatorii pe restul traseului.",
        "eta_total": "Total: {horas} h",
        "asignacion_titulo": "🚚 Ți s-a atribuit cursa {ref}",
        "asignacion_detalle": "{n} opriri · ~{km} km\nPrima oprire: {dir}",
        "geo_llegada_pregunta": "📍 Se pare că ai ajuns la {dir}. Confirmi?",
        "error_tecnico": "⚠️ Avem o problemă tehnică. Te rugăm încearcă din nou într-un minut.",
    },
    "fr": {
        "sin_viaje_activo": "Vous n'avez aucun trajet actif.",
        "viaje_completado": "Trajet {ref} terminé — {total}/{total} arrêts.\n\nBravo !",
        "resumen_ruta": "📊 Résumé du trajet : {paradas} arrêts · {km} km · {horas} h de conduite (estimé).",
        "resumen_ruta_sin_datos": "📊 {paradas} arrêts terminés. Données GPS insuffisantes pour estimer les km/heures de ce trajet.",
        "pulsa_llegada": "Appuyez quand vous arrivez au point.",
        "btn_llegado": "Je suis arrivé",
        "no_vinculado": "Vous n'êtes pas connecté. Utilisez /start VOTRE_CODE d'abord.",
        "hito_recogida": "ENLÈVEMENT",
        "hito_entrega": "LIVRAISON",
        "hito_sin_dir": "sans adresse",
        "hito_ventana": "Fenêtre",
        "confirmar_llegada": "Confirmez l'arrivée à {tipo} — {dir} ?",
        "btn_confirmar": "Oui, confirmer",
        "btn_cancelar": "Non, annuler",
        "cancelado": "Annulé. Appuyez quand vous arrivez vraiment.",
        "pedir_foto": "Arrivée enregistrée à {dir}.\n\nJ'ai besoin de la PHOTO DU BON DE LIVRAISON.\nEnvoyez-moi la photo ici.",
        "btn_sin_foto": "Je ne l'ai pas maintenant",
        "sin_pod_ok": "Livraison enregistrée à {dir} sans photo du bon de livraison.\nVotre responsable a été averti pour vérifier.",
        "recogida_ok": "Enlèvement terminé à {dir}.",
        "entrega_ok": "Livraison terminée à {dir}.",
        "aviso_pausa_561": "🕐 Vous conduisez depuis environ 4,5 h — c'est l'heure d'une pause de 45 min.",
        "foto_subiendo": "Reçu. Envoi en cours...",
        "sin_entrega_esperando": "Aucune livraison n'attend de bon.\nUtilisez /estado pour voir votre prochain arrêt.",
        "pod_ok": "Bon de livraison reçu pour {dir}.\nLivraison terminée.",
        "foto_invalida": "Cette photo ne semble pas valide. Envoyez-moi une photo normale du bon de livraison (pas un fichier ni une vidéo).",
        "foto_borrosa": "Elle est floue et difficile à lire. Envoyez-moi une autre photo, stable et bien éclairée.",
        "foto_oscura": "Elle est trop sombre pour être lue. Envoyez-moi une autre photo avec plus de lumière.",
        "foto_quemada": "Elle est surexposée par le flash ou le soleil. Envoyez-moi une autre photo sans flash direct.",
        "foto_pequena": "La photo est trop petite pour être lue clairement. Envoyez-moi une autre photo de plus près.",
        "anot_pregunta": "Tout va bien avec la marchandise livrée ?",
        "btn_anot_mojada": "💧 Arrivée mouillée",
        "btn_anot_danada": "📦 Arrivée endommagée",
        "btn_anot_faltan": "❗ Colis manquants",
        "btn_anot_sello": "🖊️ Cachet/signature illisible",
        "btn_anot_bien": "✅ Tout va bien",
        "anot_registrada": "Noté. Merci.",
        "incidencia_ayuda": "Dites-moi ce qui s'est passé : envoyez une note vocale 🎤 ou écrivez ici.",
        "inc_elige": "Que s'est-il passé ?",
        "btn_inc_averia": "🔧 Panne",
        "btn_inc_retraso": "⏱️ En retard",
        "btn_inc_carga": "📦 Problème chargement/déchargement",
        "btn_inc_otra": "🎤 Autre chose",
        "inc_desc_averia": "Panne du véhicule",
        "inc_desc_retraso": "Retard sur l'itinéraire",
        "inc_desc_carga": "Problème de chargement ou déchargement",
        "inc_otra_prompt": "Dites-moi ce qui s'est passé : envoyez une note vocale 🎤 ou écrivez un message.",
        "incidencia_ok": "Incident signalé pour le trajet {ref}. Votre responsable a été notifié.",
        "incidencia_foto_pregunta": "Si vous voulez, envoyez-moi une photo maintenant (facultatif).",
        "incidencia_foto_ok": "Photo jointe à l'incident.",
        "nota_voz_ok": "Note vocale enregistrée dans le trajet. Votre gestionnaire l'écoutera.",
        "nota_voz_sin_viaje": "Vous n'avez aucun trajet en cours auquel joindre la note vocale.",
        "btn_incidencia": "📍 Signaler un incident",
        "btn_mi_viaje": "📋 Mon trajet",
        "btn_contactar": "📞 Contacter le responsable",
        "menu_recordatorio": "Utilisez les boutons ci-dessous quand vous en avez besoin 👇",
        "contactar_info": "Votre responsable est {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Votre responsable est {nombre}.\nAucun contact direct configuré pour le moment.",
        "contactar_sin_gestor": "Votre responsable n'a pas encore configuré de contact. Essayez /incidencia si c'est urgent.",
        "contactar_prompt": "Écrivez votre message ou envoyez une note vocale 🎤 — il arrive tout de suite à votre responsable.",
        "btn_llamar": "📞 Appel urgent",
        "mensaje_gestor_ok": "Message envoyé à votre responsable.",
        "parking_titulo": "📍 Parkings à proximité :",
        "parking_sin_ubicacion": "Je n'ai pas encore votre position. Confirmez l'arrivée à un arrêt ou partagez votre position sur Telegram.",
        "parking_sin_resultados": "Aucun parking trouvé à proximité.",
        "parking_sin_resultados_radio": "Aucun parking à portée avant votre prochaine pause obligatoire.",
        "parking_radio_disponible": "Vous pouvez conduire jusqu'à ~{km} km avant votre prochaine pause obligatoire.",
        "parking_tipo_parking": "Parking",
        "parking_tipo_fueling": "Station-service / Truck stop",
        "parking_tipo_rest_area": "Aire de repos",
        "parking_tipo_otro": "Autre",
        "btn_como_llegar": "Itinéraire",
        "eta_titulo": "🕐 Temps restant estimé :",
        "eta_sin_hitos": "Pas assez de données d'itinéraire pour calculer le temps restant.",
        "eta_conduccion": "{km} km à {velocidad} km/h → {horas} h de conduite",
        "eta_parada": "pause de 45 min",
        "eta_paradas": "pauses de 45 min",
        "eta_descanso": "repos de 11h",
        "eta_descansos": "repos de 11h",
        "eta_sin_paradas": "Aucun arrêt obligatoire sur le reste du trajet.",
        "eta_total": "Total : {horas} h",
        "asignacion_titulo": "🚚 Le trajet {ref} vous a été attribué",
        "asignacion_detalle": "{n} arrêts · ~{km} km\nPremier arrêt : {dir}",
        "geo_llegada_pregunta": "📍 Il semble que vous soyez arrivé à {dir}. Confirmez ?",
        "error_tecnico": "⚠️ Nous rencontrons un problème technique. Merci de réessayer dans une minute.",
    },
    "it": {
        "sin_viaje_activo": "Non hai nessun viaggio attivo.",
        "viaje_completado": "Viaggio {ref} completato — {total}/{total} tappe.\n\nOttimo lavoro.",
        "resumen_ruta": "📊 Riepilogo del viaggio: {paradas} tappe · {km} km · {horas} h di guida (stimato).",
        "resumen_ruta_sin_datos": "📊 {paradas} tappe completate. Dati GPS insufficienti per stimare km/ore di questo viaggio.",
        "pulsa_llegada": "Premi quando arrivi al punto.",
        "btn_llegado": "Sono arrivato",
        "no_vinculado": "Non sei collegato. Usa prima /start IL_TUO_CODICE.",
        "hito_recogida": "RITIRO",
        "hito_entrega": "CONSEGNA",
        "hito_sin_dir": "senza indirizzo",
        "hito_ventana": "Finestra",
        "confirmar_llegada": "Confermi di essere arrivato al {tipo} in {dir}?",
        "btn_confirmar": "Sì, confermo",
        "btn_cancelar": "No, annulla",
        "cancelado": "Annullato. Premi quando arrivi davvero.",
        "pedir_foto": "Arrivo registrato a {dir}.\n\nOra ho bisogno della FOTO DELLA BOLLA DI CONSEGNA.\nInviami la foto qui.",
        "btn_sin_foto": "Non ce l'ho ora",
        "sin_pod_ok": "Consegna registrata a {dir} senza foto della bolla di consegna.\nIl tuo responsabile è stato avvisato di verificare.",
        "recogida_ok": "Ritiro completato a {dir}.",
        "entrega_ok": "Consegna completata a {dir}.",
        "aviso_pausa_561": "🕐 Stai guidando da circa 4,5 h — è ora di una pausa di 45 min.",
        "foto_subiendo": "Ricevuta. Caricamento foto...",
        "sin_entrega_esperando": "Nessuna consegna in attesa di bolla.\nUsa /estado per vedere la tua prossima tappa.",
        "pod_ok": "Bolla di consegna ricevuta per {dir}.\nConsegna completata.",
        "foto_invalida": "Questa foto non sembra valida. Inviami una foto normale della bolla di consegna (non un file né un video).",
        "foto_borrosa": "È sfocata e difficile da leggere. Inviami un'altra foto, ferma e con buona luce.",
        "foto_oscura": "È troppo scura per essere letta. Inviami un'altra foto con più luce.",
        "foto_quemada": "È sovraesposta dal flash o dal sole. Inviami un'altra foto senza flash diretto.",
        "foto_pequena": "La foto è troppo piccola per essere letta chiaramente. Inviami un'altra foto più da vicino.",
        "anot_pregunta": "Tutto bene con la merce consegnata?",
        "btn_anot_mojada": "💧 Arriva bagnata",
        "btn_anot_danada": "📦 Arriva danneggiata",
        "btn_anot_faltan": "❗ Mancano colli",
        "btn_anot_sello": "🖊️ Timbro/firma illeggibile",
        "btn_anot_bien": "✅ Tutto bene",
        "anot_registrada": "Annotato. Grazie.",
        "incidencia_ayuda": "Dimmi cosa è successo: inviami una nota vocale 🎤 o scrivi qui.",
        "inc_elige": "Cosa è successo?",
        "btn_inc_averia": "🔧 Guasto",
        "btn_inc_retraso": "⏱️ Sono in ritardo",
        "btn_inc_carga": "📦 Problema carico/scarico",
        "btn_inc_otra": "🎤 Altro",
        "inc_desc_averia": "Guasto del veicolo",
        "inc_desc_retraso": "Ritardo sul percorso",
        "inc_desc_carga": "Problema di carico o scarico",
        "inc_otra_prompt": "Dimmi cosa è successo: inviami una nota vocale 🎤 o scrivilo in un messaggio.",
        "incidencia_ok": "Incidente segnalato per il viaggio {ref}. Il tuo responsabile è stato avvisato.",
        "incidencia_foto_pregunta": "Se vuoi, mandami una foto ora (facoltativo).",
        "incidencia_foto_ok": "Foto allegata all'incidente.",
        "nota_voz_ok": "Nota vocale salvata nel viaggio. Il tuo gestore la ascolterà.",
        "nota_voz_sin_viaje": "Non hai nessun viaggio in corso a cui allegare la nota vocale.",
        "btn_incidencia": "📍 Segnala un incidente",
        "btn_mi_viaje": "📋 Il mio viaggio",
        "btn_contactar": "📞 Contatta il responsabile",
        "menu_recordatorio": "Usa i pulsanti qui sotto quando ti servono 👇",
        "contactar_info": "Il tuo responsabile è {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Il tuo responsabile è {nombre}.\nNon ha ancora configurato un contatto diretto.",
        "contactar_sin_gestor": "Il tuo responsabile non ha ancora configurato un contatto. Prova con /incidencia se è urgente.",
        "contactar_prompt": "Scrivimi il messaggio o mandami una nota vocale 🎤 — arriva subito al tuo responsabile.",
        "btn_llamar": "📞 Chiamata urgente",
        "mensaje_gestor_ok": "Messaggio inviato al tuo responsabile.",
        "parking_titulo": "📍 Parcheggi vicini:",
        "parking_sin_ubicacion": "Non ho ancora la tua posizione. Conferma l'arrivo a una tappa o condividi la tua posizione su Telegram.",
        "parking_sin_resultados": "Non ho trovato parcheggi vicini.",
        "parking_sin_resultados_radio": "Nessun parcheggio raggiungibile prima della prossima pausa obbligatoria.",
        "parking_radio_disponible": "Puoi guidare fino a ~{km} km prima della prossima pausa obbligatoria.",
        "parking_tipo_parking": "Parcheggio",
        "parking_tipo_fueling": "Stazione di servizio / Truck stop",
        "parking_tipo_rest_area": "Area di sosta",
        "parking_tipo_otro": "Altro",
        "btn_como_llegar": "Indicazioni",
        "eta_titulo": "🕐 Tempo stimato rimanente:",
        "eta_sin_hitos": "Non ho abbastanza dati sul percorso per calcolare il tempo rimanente.",
        "eta_conduccion": "{km} km a {velocidad} km/h → {horas} h di guida",
        "eta_parada": "pausa di 45 min",
        "eta_paradas": "pause di 45 min",
        "eta_descanso": "riposo di 11h",
        "eta_descansos": "riposi di 11h",
        "eta_sin_paradas": "Nessuna sosta obbligatoria nel resto del percorso.",
        "eta_total": "Totale: {horas} h",
        "asignacion_titulo": "🚚 Ti è stato assegnato il viaggio {ref}",
        "asignacion_detalle": "{n} tappe · ~{km} km\nPrima tappa: {dir}",
        "geo_llegada_pregunta": "📍 Sembra che tu sia arrivato a {dir}. Confermi?",
        "error_tecnico": "⚠️ Stiamo riscontrando un problema tecnico. Riprova tra un minuto.",
    },
    "pt": {
        "sin_viaje_activo": "Não tens nenhuma viagem ativa.",
        "viaje_completado": "Viagem {ref} concluída — {total}/{total} paragens.\n\nBom trabalho.",
        "resumen_ruta": "📊 Resumo da viagem: {paradas} paragens · {km} km · {horas} h de condução (estimado).",
        "resumen_ruta_sin_datos": "📊 {paradas} paragens concluídas. Dados de GPS insuficientes para estimar km/horas desta viagem.",
        "pulsa_llegada": "Toca quando chegares ao ponto.",
        "btn_llegado": "Cheguei",
        "no_vinculado": "Não estás associado. Usa /start O_TEU_CODIGO primeiro.",
        "hito_recogida": "RECOLHA",
        "hito_entrega": "ENTREGA",
        "hito_sin_dir": "sem morada",
        "hito_ventana": "Janela",
        "confirmar_llegada": "Confirmas que chegaste à {tipo} em {dir}?",
        "btn_confirmar": "Sim, confirmo",
        "btn_cancelar": "Não, cancelar",
        "cancelado": "Cancelado. Toca quando chegares mesmo.",
        "pedir_foto": "Chegada registada em {dir}.\n\nAgora preciso da FOTO DA GUIA DE TRANSPORTE.\nEnvia-me a foto por aqui.",
        "btn_sin_foto": "Não a tenho agora",
        "sin_pod_ok": "Entrega registada em {dir} sem foto da guia de transporte.\nO teu gestor foi avisado para verificar.",
        "recogida_ok": "Recolha concluída em {dir}.",
        "entrega_ok": "Entrega concluída em {dir}.",
        "aviso_pausa_561": "🕐 Estás a conduzir há cerca de 4,5 h — é hora de uma pausa de 45 min.",
        "foto_subiendo": "Recebida. A carregar foto...",
        "sin_entrega_esperando": "Não há nenhuma entrega à espera de guia.\nUsa /estado para veres a tua próxima paragem.",
        "pod_ok": "Guia de transporte recebida para {dir}.\nEntrega concluída.",
        "foto_invalida": "Essa foto não parece válida. Envia-me uma foto normal da guia de transporte (não um ficheiro nem um vídeo).",
        "foto_borrosa": "Está desfocada e difícil de ler. Envia-me outra foto, parada e com boa luz.",
        "foto_oscura": "Está demasiado escura para ler. Envia-me outra foto com mais luz.",
        "foto_quemada": "Está sobreexposta pelo flash ou pelo sol. Envia-me outra foto sem flash direto.",
        "foto_pequena": "A foto é demasiado pequena para ler bem. Envia-me outra foto mais de perto.",
        "anot_pregunta": "Está tudo bem com a mercadoria entregue?",
        "btn_anot_mojada": "💧 Chega molhada",
        "btn_anot_danada": "📦 Chega danificada",
        "btn_anot_faltan": "❗ Faltam volumes",
        "btn_anot_sello": "🖊️ Carimbo/assinatura ilegível",
        "btn_anot_bien": "✅ Tudo bem",
        "anot_registrada": "Registado. Obrigado.",
        "incidencia_ayuda": "Diz-me o que aconteceu: envia-me uma nota de voz 🎤 ou escreve aqui.",
        "inc_elige": "O que aconteceu?",
        "btn_inc_averia": "🔧 Avaria",
        "btn_inc_retraso": "⏱️ Estou atrasado",
        "btn_inc_carga": "📦 Problema na carga/descarga",
        "btn_inc_otra": "🎤 Outra coisa",
        "inc_desc_averia": "Avaria do veículo",
        "inc_desc_retraso": "Atraso na rota",
        "inc_desc_carga": "Problema na carga ou descarga",
        "inc_otra_prompt": "Diz-me o que aconteceu: envia-me uma nota de voz 🎤 ou escreve numa mensagem.",
        "incidencia_ok": "Incidência reportada para a viagem {ref}. O teu gestor foi notificado.",
        "incidencia_foto_pregunta": "Se quiseres, manda-me uma foto agora (opcional).",
        "incidencia_foto_ok": "Foto anexada à incidência.",
        "nota_voz_ok": "Nota de voz guardada na viagem. O teu gestor vai ouvi-la.",
        "nota_voz_sin_viaje": "Não tens nenhuma viagem em curso à qual anexar a nota de voz.",
        "btn_incidencia": "📍 Reportar incidência",
        "btn_mi_viaje": "📋 A minha viagem",
        "btn_contactar": "📞 Contactar gestor",
        "menu_recordatorio": "Usa os botões abaixo quando precisares 👇",
        "contactar_info": "O teu gestor é {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "O teu gestor é {nombre}.\nAinda não configurou um contacto direto.",
        "contactar_sin_gestor": "O teu gestor ainda não configurou um contacto. Experimenta /incidencia se for urgente.",
        "contactar_prompt": "Escreve-me a mensagem ou envia-me uma nota de voz 🎤 — chega já ao teu gestor.",
        "btn_llamar": "📞 Chamada urgente",
        "mensaje_gestor_ok": "Mensagem enviada ao teu gestor.",
        "parking_titulo": "📍 Parques de estacionamento próximos:",
        "parking_sin_ubicacion": "Ainda não tenho a tua localização. Confirma a chegada a uma paragem ou partilha a tua localização no Telegram.",
        "parking_sin_resultados": "Não encontrei parques de estacionamento próximos.",
        "parking_sin_resultados_radio": "Sem parques de estacionamento ao alcance antes da próxima pausa obrigatória.",
        "parking_radio_disponible": "Podes conduzir até ~{km} km antes da próxima pausa obrigatória.",
        "parking_tipo_parking": "Parque de estacionamento",
        "parking_tipo_fueling": "Bomba de gasolina / Truck stop",
        "parking_tipo_rest_area": "Área de descanso",
        "parking_tipo_otro": "Outro",
        "btn_como_llegar": "Como chegar",
        "eta_titulo": "🕐 Tempo restante estimado:",
        "eta_sin_hitos": "Não tenho dados suficientes da rota para calcular o tempo restante.",
        "eta_conduccion": "{km} km a {velocidad} km/h → {horas} h de condução",
        "eta_parada": "pausa de 45 min",
        "eta_paradas": "pausas de 45 min",
        "eta_descanso": "descanso de 11h",
        "eta_descansos": "descansos de 11h",
        "eta_sin_paradas": "Sem paragens obrigatórias no resto da rota.",
        "eta_total": "Total: {horas} h",
        "asignacion_titulo": "🚚 Foi-te atribuída a viagem {ref}",
        "asignacion_detalle": "{n} paragens · ~{km} km\nPrimeira paragem: {dir}",
        "geo_llegada_pregunta": "📍 Parece que chegaste a {dir}. Confirmas?",
        "error_tecnico": "⚠️ Estamos com um problema técnico. Por favor, tenta novamente dentro de um minuto.",
    },
    "de": {
        "sin_viaje_activo": "Du hast keine aktive Fahrt.",
        "viaje_completado": "Fahrt {ref} abgeschlossen — {total}/{total} Stopps.\n\nGut gemacht!",
        "resumen_ruta": "📊 Fahrtzusammenfassung: {paradas} Stopps · {km} km · {horas} Std. Fahrzeit (geschätzt).",
        "resumen_ruta_sin_datos": "📊 {paradas} Stopps abgeschlossen. Nicht genug GPS-Daten, um km/Stunden dieser Fahrt zu schätzen.",
        "pulsa_llegada": "Tippe, wenn du am Punkt ankommst.",
        "btn_llegado": "Ich bin angekommen",
        "no_vinculado": "Du bist nicht verknüpft. Nutze zuerst /start DEIN_CODE.",
        "hito_recogida": "ABHOLUNG",
        "hito_entrega": "LIEFERUNG",
        "hito_sin_dir": "keine Adresse",
        "hito_ventana": "Zeitfenster",
        "confirmar_llegada": "Bestätigst du die Ankunft bei {tipo} in {dir}?",
        "btn_confirmar": "Ja, bestätigen",
        "btn_cancelar": "Nein, abbrechen",
        "cancelado": "Abgebrochen. Tippe, wenn du wirklich ankommst.",
        "pedir_foto": "Ankunft in {dir} erfasst.\n\nJetzt brauche ich das FOTO DES LIEFERSCHEINS.\nSchick mir das Foto hier.",
        "btn_sin_foto": "Habe ich gerade nicht",
        "sin_pod_ok": "Lieferung in {dir} ohne Lieferscheinfoto erfasst.\nDein Disponent wurde benachrichtigt.",
        "recogida_ok": "Abholung in {dir} abgeschlossen.",
        "entrega_ok": "Lieferung in {dir} abgeschlossen.",
        "aviso_pausa_561": "🕐 Du fährst seit etwa 4,5 Std. — Zeit für eine 45-Min-Pause.",
        "foto_subiendo": "Erhalten. Foto wird hochgeladen...",
        "sin_entrega_esperando": "Es wartet keine Lieferung auf einen Lieferschein.\nNutze /estado, um deinen nächsten Stopp zu sehen.",
        "pod_ok": "Lieferschein für {dir} erhalten.\nLieferung abgeschlossen.",
        "foto_invalida": "Dieses Foto scheint ungültig zu sein. Schick mir ein normales Foto des Lieferscheins (keine Datei und kein Video).",
        "foto_borrosa": "Es ist verwackelt und schlecht lesbar. Schick mir ein weiteres Foto, ruhig gehalten und mit gutem Licht.",
        "foto_oscura": "Es ist zu dunkel zum Lesen. Schick mir ein weiteres Foto mit mehr Licht.",
        "foto_quemada": "Es ist durch Blitz oder Sonne überbelichtet. Schick mir ein weiteres Foto ohne direkten Blitz.",
        "foto_pequena": "Das Foto ist zu klein, um es klar zu lesen. Schick mir ein weiteres Foto aus der Nähe.",
        "anot_pregunta": "Ist mit der gelieferten Ware alles in Ordnung?",
        "btn_anot_mojada": "💧 Kommt nass an",
        "btn_anot_danada": "📦 Kommt beschädigt an",
        "btn_anot_faltan": "❗ Pakete fehlen",
        "btn_anot_sello": "🖊️ Stempel/Unterschrift unleserlich",
        "btn_anot_bien": "✅ Alles in Ordnung",
        "anot_registrada": "Notiert. Danke.",
        "incidencia_ayuda": "Sag mir, was passiert ist: Schick mir eine Sprachnachricht 🎤 oder schreib hier.",
        "inc_elige": "Was ist passiert?",
        "btn_inc_averia": "🔧 Panne",
        "btn_inc_retraso": "⏱️ Ich habe Verspätung",
        "btn_inc_carga": "📦 Problem beim Be-/Entladen",
        "btn_inc_otra": "🎤 Etwas anderes",
        "inc_desc_averia": "Fahrzeugpanne",
        "inc_desc_retraso": "Verspätung auf der Route",
        "inc_desc_carga": "Problem beim Be- oder Entladen",
        "inc_otra_prompt": "Sag mir, was passiert ist: Schick mir eine Sprachnachricht 🎤 oder schreib eine Nachricht.",
        "incidencia_ok": "Vorfall für Fahrt {ref} gemeldet. Dein Disponent wurde benachrichtigt.",
        "incidencia_foto_pregunta": "Wenn du magst, schick mir jetzt ein Foto (optional).",
        "incidencia_foto_ok": "Foto zum Vorfall hinzugefügt.",
        "nota_voz_ok": "Sprachnachricht zur Fahrt gespeichert. Dein Disponent wird sie anhören.",
        "nota_voz_sin_viaje": "Du hast keine laufende Fahrt, an die die Sprachnachricht angehängt werden kann.",
        "btn_incidencia": "📍 Vorfall melden",
        "btn_mi_viaje": "📋 Meine Fahrt",
        "btn_contactar": "📞 Disponent kontaktieren",
        "menu_recordatorio": "Nutze die Schaltflächen unten, wann immer du sie brauchst 👇",
        "contactar_info": "Dein Disponent ist {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Dein Disponent ist {nombre}.\nHat noch keinen direkten Kontakt hinterlegt.",
        "contactar_sin_gestor": "Dein Disponent hat noch keinen Kontakt hinterlegt. Nutze /incidencia, wenn es dringend ist.",
        "contactar_prompt": "Schreib mir deine Nachricht oder schick eine Sprachnachricht 🎤 — sie erreicht deinen Disponenten sofort.",
        "btn_llamar": "📞 Dringender Anruf",
        "mensaje_gestor_ok": "Nachricht an deinen Disponenten gesendet.",
        "parking_titulo": "📍 Parkplätze in der Nähe:",
        "parking_sin_ubicacion": "Ich habe deinen Standort noch nicht. Bestätige die Ankunft an einem Stopp oder teile deinen Standort über Telegram.",
        "parking_sin_resultados": "Keine Parkplätze in der Nähe gefunden.",
        "parking_sin_resultados_radio": "Kein Parkplatz erreichbar vor der nächsten Pflichtpause.",
        "parking_radio_disponible": "Du kannst noch ~{km} km fahren bis zur nächsten Pflichtpause.",
        "parking_tipo_parking": "Parkplatz",
        "parking_tipo_fueling": "Tankstelle / Truck Stop",
        "parking_tipo_rest_area": "Rastplatz",
        "parking_tipo_otro": "Sonstiges",
        "btn_como_llegar": "Route",
        "eta_titulo": "🕐 Geschätzte verbleibende Zeit:",
        "eta_sin_hitos": "Nicht genug Streckendaten, um die verbleibende Zeit zu berechnen.",
        "eta_conduccion": "{km} km bei {velocidad} km/h → {horas} h Fahrzeit",
        "eta_parada": "45-Min-Pause",
        "eta_paradas": "45-Min-Pausen",
        "eta_descanso": "11-Std-Ruhezeit",
        "eta_descansos": "11-Std-Ruhezeiten",
        "eta_sin_paradas": "Keine Pflichtstopps auf dem Rest der Strecke.",
        "eta_total": "Gesamt: {horas} h",
        "asignacion_titulo": "🚚 Dir wurde die Fahrt {ref} zugewiesen",
        "asignacion_detalle": "{n} Stopps · ~{km} km\nErster Stopp: {dir}",
        "geo_llegada_pregunta": "📍 Es sieht so aus, als wärst du in {dir} angekommen. Bestätigst du das?",
        "error_tecnico": "⚠️ Wir haben gerade ein technisches Problem. Bitte versuch es in einer Minute erneut.",
    },
    "ar": {
        "sin_viaje_activo": "ليس لديك أي رحلة نشطة.",
        "viaje_completado": "اكتملت الرحلة {ref} — {total}/{total} محطات.\n\nعمل ممتاز.",
        "resumen_ruta": "📊 ملخص الرحلة: {paradas} محطات · {km} كم · {horas} ساعة قيادة (تقديري).",
        "resumen_ruta_sin_datos": "📊 اكتملت {paradas} محطات. لا توجد بيانات GPS كافية لتقدير الكيلومترات/الساعات لهذه الرحلة.",
        "pulsa_llegada": "اضغط عند وصولك إلى النقطة.",
        "btn_llegado": "لقد وصلت",
        "no_vinculado": "لست مرتبطًا بعد. استخدم /start رمزك أولاً.",
        "hito_recogida": "الاستلام",
        "hito_entrega": "التسليم",
        "hito_sin_dir": "بدون عنوان",
        "hito_ventana": "النافذة الزمنية",
        "confirmar_llegada": "هل تؤكد وصولك إلى {tipo} في {dir}؟",
        "btn_confirmar": "نعم، أؤكد",
        "btn_cancelar": "لا، إلغاء",
        "cancelado": "تم الإلغاء. اضغط عند وصولك فعليًا.",
        "pedir_foto": "تم تسجيل الوصول في {dir}.\n\nأحتاج الآن إلى صورة سند التسليم.\nأرسل لي الصورة هنا.",
        "btn_sin_foto": "ليست معي الآن",
        "sin_pod_ok": "تم تسجيل التسليم في {dir} بدون صورة سند التسليم.\nتم إخطار المسؤول للمتابعة.",
        "recogida_ok": "تم الاستلام في {dir}.",
        "entrega_ok": "تم إتمام التسليم في {dir}.",
        "aviso_pausa_561": "🕐 أنت تقود منذ حوالي 4.5 ساعة — حان وقت استراحة 45 دقيقة.",
        "foto_subiendo": "تم الاستلام. جارٍ رفع الصورة...",
        "sin_entrega_esperando": "لا يوجد تسليم بانتظار سند.\nاستخدم /estado لمعرفة محطتك التالية.",
        "pod_ok": "تم استلام سند التسليم لـ {dir}.\nاكتمل التسليم.",
        "foto_invalida": "هذه الصورة لا تبدو صالحة. أرسل لي صورة عادية لسند التسليم (وليس ملفًا أو فيديو).",
        "foto_borrosa": "الصورة غير واضحة ويصعب قراءتها. أرسل لي صورة أخرى ثابتة وبإضاءة جيدة.",
        "foto_oscura": "الصورة مظلمة جدًا ولا يمكن قراءتها. أرسل لي صورة أخرى بإضاءة أكثر.",
        "foto_quemada": "الصورة محروقة بسبب الفلاش أو الشمس. أرسل لي صورة أخرى بدون فلاش مباشر.",
        "foto_pequena": "الصورة صغيرة جدًا ولا تُقرأ بوضوح. أرسل لي صورة أخرى أقرب.",
        "anot_pregunta": "هل البضاعة المسلَّمة بحالة جيدة؟",
        "btn_anot_mojada": "💧 وصلت مبللة",
        "btn_anot_danada": "📦 وصلت تالفة",
        "btn_anot_faltan": "❗ طرود ناقصة",
        "btn_anot_sello": "🖊️ الختم/التوقيع غير واضح",
        "btn_anot_bien": "✅ كل شيء جيد",
        "anot_registrada": "تم التسجيل. شكرًا.",
        "incidencia_ayuda": "أخبرني بما حدث: أرسل لي رسالة صوتية 🎤 أو اكتب هنا.",
        "inc_elige": "ماذا حدث؟",
        "btn_inc_averia": "🔧 عطل",
        "btn_inc_retraso": "⏱️ متأخر",
        "btn_inc_carga": "📦 مشكلة في التحميل/التفريغ",
        "btn_inc_otra": "🎤 شيء آخر",
        "inc_desc_averia": "عطل في المركبة",
        "inc_desc_retraso": "تأخير في الطريق",
        "inc_desc_carga": "مشكلة في التحميل أو التفريغ",
        "inc_otra_prompt": "أخبرني بما حدث: أرسل لي رسالة صوتية 🎤 أو اكتبها في رسالة.",
        "incidencia_ok": "تم الإبلاغ عن حادثة للرحلة {ref}. تم إخطار المسؤول عنك.",
        "incidencia_foto_pregunta": "إذا أردت، أرسل لي صورة الآن (اختياري).",
        "incidencia_foto_ok": "تم إرفاق الصورة بالحادثة.",
        "nota_voz_ok": "تم حفظ الرسالة الصوتية في الرحلة. سيستمع إليها مديرك.",
        "nota_voz_sin_viaje": "ليس لديك رحلة جارية لإرفاق الرسالة الصوتية بها.",
        "btn_incidencia": "📍 الإبلاغ عن حادثة",
        "btn_mi_viaje": "📋 رحلتي",
        "btn_contactar": "📞 الاتصال بالمسؤول",
        "menu_recordatorio": "استخدم الأزرار في الأسفل عند الحاجة 👇",
        "contactar_info": "المسؤول عنك هو {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "المسؤول عنك هو {nombre}.\nلم يقم بعد بإعداد وسيلة تواصل مباشرة.",
        "contactar_sin_gestor": "لم يقم المسؤول عنك بعد بإعداد وسيلة تواصل. جرّب /incidencia إذا كان الأمر عاجلاً.",
        "contactar_prompt": "اكتب رسالتك أو أرسل لي رسالة صوتية 🎤 — ستصل إلى مسؤولك فورًا.",
        "btn_llamar": "📞 اتصال عاجل",
        "mensaje_gestor_ok": "تم إرسال الرسالة إلى مسؤولك.",
        "parking_titulo": "📍 مواقف قريبة:",
        "parking_sin_ubicacion": "لا أملك موقعك بعد. أكّد وصولك إلى إحدى المحطات أو شارك موقعك عبر تيليجرام.",
        "parking_sin_resultados": "لم أجد مواقف قريبة.",
        "parking_sin_resultados_radio": "لا توجد مواقف يمكن الوصول إليها قبل التوقف الإلزامي التالي.",
        "parking_radio_disponible": "يمكنك القيادة حتى ~{km} كم قبل التوقف الإلزامي التالي.",
        "parking_tipo_parking": "موقف سيارات",
        "parking_tipo_fueling": "محطة وقود / Truck stop",
        "parking_tipo_rest_area": "منطقة راحة",
        "parking_tipo_otro": "آخر",
        "btn_como_llegar": "الاتجاهات",
        "eta_titulo": "🕐 الوقت المتبقي المقدر:",
        "eta_sin_hitos": "لا تتوفر بيانات مسار كافية لحساب الوقت المتبقي.",
        "eta_conduccion": "{km} كم بسرعة {velocidad} كم/س ← {horas} س قيادة",
        "eta_parada": "استراحة 45 دقيقة",
        "eta_paradas": "استراحات 45 دقيقة",
        "eta_descanso": "راحة 11 ساعة",
        "eta_descansos": "فترات راحة 11 ساعة",
        "eta_sin_paradas": "لا توجد محطات إلزامية في باقي المسار.",
        "eta_total": "الإجمالي: {horas} س",
        "asignacion_titulo": "🚚 تم تكليفك بالرحلة {ref}",
        "asignacion_detalle": "{n} محطات · ~{km} كم\nالمحطة الأولى: {dir}",
        "geo_llegada_pregunta": "📍 يبدو أنك وصلت إلى {dir}. هل تؤكد؟",
        "error_tecnico": "⚠️ نواجه مشكلة تقنية. يرجى المحاولة مرة أخرى بعد دقيقة.",
    },
}

# Textos de los 3 botones del menu persistente, en todos los idiomas soportados,
# para reconocer la pulsacion sin importar el idioma del chofer que la mando.
BOTONES_INCIDENCIA = {textos["btn_incidencia"] for textos in TEXTOS.values()}
BOTONES_MI_VIAJE = {textos["btn_mi_viaje"] for textos in TEXTOS.values()}
BOTONES_CONTACTAR = {textos["btn_contactar"] for textos in TEXTOS.values()}


def t(chofer_or_idioma, key, **kwargs):
    """Devuelve el texto localizado. Acepta un dict de chófer o un str de idioma."""
    if isinstance(chofer_or_idioma, dict):
        idioma = (chofer_or_idioma.get("idioma") or "es").lower()
    else:
        idioma = (chofer_or_idioma or "es").lower()
    textos = TEXTOS.get(idioma, TEXTOS["es"])
    msg = textos.get(key, TEXTOS["es"].get(key, key))
    return msg.format(**kwargs) if kwargs else msg


def get_chofer_by_chat(chat_id):
    r = ejecutar_con_reintentos(
        lambda: supabase.table("chofer").select("id, nombre, empresa_id").eq("chat_id", str(chat_id)).execute(),
        contexto={"accion": "get_chofer_by_chat", "chat_id": str(chat_id)},
    )
    return r.data[0] if r.data else None


def get_gestor_by_chat(chat_id):
    """18.D.7: equivalente a get_chofer_by_chat pero para gestores -- la
    cotización por texto (/cotizar) es una función de gestor, no de chófer."""
    r = ejecutar_con_reintentos(
        lambda: supabase.table("gestor").select("id, nombre, empresa_id").eq("telegram_chat_id", str(chat_id)).eq("activo", True).execute(),
        contexto={"accion": "get_gestor_by_chat", "chat_id": str(chat_id)},
    )
    return r.data[0] if r.data else None


def empresa_requiere_pod(empresa_id):
    """`empresa.requiere_pod` existe en el esquema desde el Milestone 3
    (migración 0002) pero nunca se conectó a nada -- hasta ahora TODAS las
    empresas pedían foto de albarán siempre. True por defecto (mismo
    criterio que la columna en la BD) si no hay fila o el valor es NULL."""
    r = ejecutar_con_reintentos(
        lambda: supabase.table("empresa").select("requiere_pod").eq("id", empresa_id).execute(),
        contexto={"accion": "empresa_requiere_pod", "empresa_id": empresa_id},
    )
    if not r.data:
        return True
    valor = r.data[0].get("requiere_pod")
    return True if valor is None else valor


class Transporte:
    """Interfaz mínima de envío de mensajes al GESTOR (no al chófer, cuyo flujo
    usa botones interactivos propios de Telegram — callback_query, reply
    keyboard — y no se abstrae aquí). Aislar este envío detrás de una interfaz
    permite en el futuro añadir un TransporteWhatsApp sin tocar la lógica de
    negocio de alertar_gestor/notificar_gestor_evento.
    """

    async def enviar_texto(self, chat_id, texto):
        raise NotImplementedError


class TransporteTelegram(Transporte):
    def __init__(self, token):
        self._token = token

    async def enviar_texto(self, chat_id, texto):
        from telegram import Bot
        bot = Bot(token=self._token)
        await bot.send_message(chat_id=chat_id, text=texto)


transporte_gestor = TransporteTelegram(TOKEN)


def verificar_hito_pertenece_a_chofer(hito_id, chofer_id):
    """Verifica que el hito pertenece a un viaje asignado a este chófer."""
    r = ejecutar_con_reintentos(
        lambda: supabase.table("hito")
        .select("*, viaje!inner(id, chofer_id, estado, referencia)")
        .eq("id", hito_id)
        .execute(),
        contexto={"accion": "verificar_hito_pertenece_a_chofer", "hito_id": hito_id, "chofer_id": chofer_id},
    )
    if not r.data:
        return None, "Hito no encontrado."
    hito = r.data[0]
    viaje = hito.get("viaje")
    if not viaje or viaje.get("chofer_id") != chofer_id:
        return None, "Este hito no pertenece a tu viaje."
    if viaje.get("estado") not in ("en_curso", "planificado"):
        return None, "Este viaje ya no está activo."
    return hito, None


def columna_pref_notificacion(tipo):
    """R2 (2026-07-15): qué columna `gestor.notif_*` gatea cada tipo de aviso.
    Las tres son NOT NULL con su propio DEFAULT (0007) -- no hace falta tratar
    NULL aquí, cada gestor siempre tiene un valor real."""
    if tipo == "fuera_de_ventana":
        return "notif_fuera_ventana"
    return "notif_incidencias"


def _gestores_a_notificar(empresa_id, columna_pref, viaje_id=None):
    """Gestores ACTIVOS de la empresa con la preferencia `columna_pref`
    activada y Telegram vinculado -- R2 (2026-07-15): antes `alertar_gestor`/
    `notificar_gestor_evento` mandaban a TODOS los gestores con chat_id, sin
    mirar ni `activo` ni ninguna preferencia (las tres quedaban decorativas).

    Fase 15 (2026-07-15, hallazgo posterior): si el viaje tiene `gestor_id`
    asignado, solo ESE gestor (o un `admin`) debe enterarse -- mismo criterio
    de visibilidad que la política RLS de `chofer`/`viaje` (F15.2). El bot
    corre con privilegios de servicio y NO pasa por RLS, así que sin este
    filtro un gestor NO asignado seguía recibiendo por Telegram avisos de
    viajes que ni siquiera puede ver en su propio dashboard -- una fuga de
    información entre el modelo de visibilidad (Fase 15) y el de avisos
    (R1/R2), construidos en sesiones distintas y no coordinados hasta ahora."""
    gestor_id_asignado = None
    if viaje_id:
        v = supabase.table("viaje").select("gestor_id").eq("id", viaje_id).execute()
        if v.data:
            gestor_id_asignado = v.data[0].get("gestor_id")

    r = (
        supabase.table("gestor")
        .select("telegram_chat_id, rol, id")
        .eq("empresa_id", empresa_id)
        .eq("activo", True)
        .eq(columna_pref, True)
        .execute()
    )
    gestores = r.data or []
    if gestor_id_asignado:
        gestores = [g for g in gestores if g.get("rol") == "admin" or g.get("id") == gestor_id_asignado]
    return [g["telegram_chat_id"] for g in gestores if g.get("telegram_chat_id")]


async def alertar_gestor(empresa_id, viaje_id, tipo, descripcion):
    """Crea una incidencia y notifica a los gestores de la empresa por Telegram
    -- solo a los ACTIVOS con la preferencia correspondiente activada (R2),
    y solo al gestor asignado del viaje si lo tiene (Fase 15). Devuelve el id
    de la incidencia creada (F14.6: el chófer puede adjuntarle una foto justo
    después, necesita saber a cuál)."""
    r = supabase.table("incidencia").insert({
        "viaje_id": viaje_id,
        "tipo": tipo,
        "descripcion": descripcion,
        "estado": "abierta",
    }).execute()
    incidencia_id = r.data[0]["id"] if r.data else None

    chats = _gestores_a_notificar(empresa_id, columna_pref_notificacion(tipo), viaje_id)
    for chat in chats:
        try:
            viaje_r = supabase.table("viaje").select("referencia").eq("id", viaje_id).execute()
            ref = viaje_r.data[0]["referencia"] if viaje_r.data else viaje_id[:8]
            await transporte_gestor.enviar_texto(
                chat,
                f"⚠️ ALERTA — {tipo.replace('_', ' ').upper()}\n\nViaje: {ref}\n{descripcion}",
            )
        except Exception as e:
            logger.error(
                "Error notificando gestor %s: %s", chat, e,
                extra={"empresa_id": empresa_id, "viaje_id": viaje_id, "tipo": tipo, "chat_id": chat},
            )

    return incidencia_id


async def notificar_gestor_evento(empresa_id, viaje_id, mensaje, tipo_notif="entregas"):
    """Envía notificación informativa (no incidencia) a los gestores -- solo a
    los ACTIVOS con la preferencia correspondiente (R2). `tipo_notif`:
    "entregas" (default, cubre entrega/POD/viaje completado/asignación, los
    4 usos actuales) o "incidencias". Devuelve cuántos gestores recibieron el
    mensaje de verdad -- el llamador (p.ej. `procesar_notificaciones_asignacion`,
    hallazgo 2026-07-15) lo usa para no marcar "ya avisado" cuando en
    realidad no llegó a NADIE (chofer sin Telegram Y sin ningún gestor
    notificable), que antes se daba por resuelto en silencio."""
    columna_pref = "notif_entregas" if tipo_notif == "entregas" else "notif_incidencias"
    chats = _gestores_a_notificar(empresa_id, columna_pref, viaje_id)
    notificados = 0
    for chat in chats:
        try:
            await transporte_gestor.enviar_texto(chat, mensaje)
            notificados += 1
        except Exception as e:
            logger.error(
                "Error notificando gestor %s: %s", chat, e,
                extra={"empresa_id": empresa_id, "viaje_id": viaje_id, "chat_id": chat},
            )
    return notificados


def nav_buttons(hito):
    buttons = []
    lat, lon = hito.get("lat"), hito.get("lon")
    direccion = hito.get("direccion", "")

    if lat and lon:
        gmaps = f"https://www.google.com/maps/dir/?api=1&destination={lat},{lon}"
        waze = f"https://waze.com/ul?ll={lat},{lon}&navigate=yes"
    elif direccion:
        gmaps = f"https://www.google.com/maps/dir/?api=1&destination={quote_plus(direccion)}"
        waze = f"https://waze.com/ul?q={quote_plus(direccion)}&navigate=yes"
    else:
        return buttons

    buttons.append([
        InlineKeyboardButton("Google Maps", url=gmaps),
        InlineKeyboardButton("Waze", url=waze),
    ])

    if hito.get("link_extra"):
        buttons.append([
            InlineKeyboardButton("Parking / punto especial", url=hito["link_extra"]),
        ])

    return buttons


def build_hito_message(hito, orden_actual, total_hitos, idioma="es"):
    tipo = t(idioma, "hito_recogida") if hito["tipo"] == "recogida" else t(idioma, "hito_entrega")
    direccion = hito.get("direccion") or t(idioma, "hito_sin_dir")

    texto = f"📍 Hito {orden_actual}/{total_hitos} — {tipo}\n"
    texto += f"📫 {direccion}\n"

    if hito.get("ventana_inicio") or hito.get("ventana_fin"):
        inicio = hito.get("ventana_inicio", "?")
        fin = hito.get("ventana_fin", "?")
        texto += f"🕐 {t(idioma, 'hito_ventana')}: {inicio} – {fin}\n"

    if hito.get("notas"):
        texto += f"📝 {hito['notas']}\n"

    return texto


async def send_next_hito(chat_id, chofer, bot, chat_data=None):
    chofer_id = chofer["id"]
    viajes_r = (
        supabase.table("viaje")
        .select("id, referencia")
        .eq("chofer_id", chofer_id)
        .eq("estado", "en_curso")
        .execute()
    )

    if not viajes_r.data:
        await bot.send_message(chat_id=chat_id, text=t(chofer, "sin_viaje_activo"))
        return

    viaje = viajes_r.data[0]
    ref = viaje.get("referencia") or viaje["id"][:8]

    hitos_r = (
        supabase.table("hito")
        .select("*")
        .eq("viaje_id", viaje["id"])
        .order("orden")
        .execute()
    )

    hitos = hitos_r.data or []
    total = len(hitos)
    completados = sum(1 for h in hitos if h["estado"] == "completado")
    pendiente = next((h for h in hitos if h["estado"] in ("pendiente", "en_curso")), None)

    if not pendiente:
        supabase.table("viaje").update({"estado": "completado"}).eq("id", viaje["id"]).execute()
        supabase.table("ejecucion_evento").insert({
            "viaje_id": viaje["id"],
            "chofer_id": chofer_id,
            "tipo": "viaje_completado",
        }).execute()

        await notificar_gestor_evento(
            chofer["empresa_id"],
            viaje["id"],
            f"✅ Viaje {ref} completado — {total}/{total} hitos. Chófer: {chofer['nombre']}",
        )

        await bot.send_message(
            chat_id=chat_id,
            text=t(chofer, "viaje_completado", ref=ref, total=total),
        )

        # F14.5: resumen de ruta al chófer, disparado al TERMINAR la ruta
        # (evento, no cron -- decisión del usuario 2026-07-15).
        inicio_r = (
            supabase.table("ejecucion_evento")
            .select("ocurrido_en")
            .eq("viaje_id", viaje["id"])
            .order("ocurrido_en")
            .limit(1)
            .execute()
        )
        inicio = inicio_r.data[0].get("ocurrido_en") if inicio_r.data else None
        emp_r = supabase.table("empresa").select("velocidad_planificacion_kmh").eq("id", chofer["empresa_id"]).execute()
        velocidad = (emp_r.data[0].get("velocidad_planificacion_kmh") if emp_r.data else None) or VELOCIDAD_PLANIFICACION_KMH_DEFAULT
        resumen = await resumen_ruta_completada(chofer_id, inicio, velocidad, total)
        if resumen["km"] is not None:
            texto_resumen = t(chofer, "resumen_ruta", paradas=resumen["paradas"], km=resumen["km"], horas=resumen["horas"])
        else:
            texto_resumen = t(chofer, "resumen_ruta_sin_datos", paradas=resumen["paradas"])
        await bot.send_message(chat_id=chat_id, text=texto_resumen)
        return

    idioma = chofer.get("idioma", "es")
    texto = f"Viaje {ref} — {completados}/{total} hitos\n\n"
    texto += build_hito_message(pendiente, pendiente["orden"], total, idioma=idioma)
    texto += f"\n{t(chofer, 'pulsa_llegada')}"

    buttons = nav_buttons(pendiente)
    buttons.append([
        InlineKeyboardButton(t(chofer, "btn_llegado"), callback_data=f"pre_llegada:{pendiente['id']}")
    ])

    await bot.send_message(
        chat_id=chat_id,
        text=texto,
        reply_markup=InlineKeyboardMarkup(buttons),
    )
    # 2026-07-23: Telegram cachea el ÚLTIMO ReplyKeyboardMarkup que recibió el
    # chat; si solo se manda en /start, un cambio de diseño del menú (o un
    # chófer que lo cerró) no se ve nunca. Se reenvía UNA vez por sesión del
    # proceso (chat_data se vacía en cada reinicio del bot, justo cuando puede
    # haber cambiado el diseño) para refrescarlo sin spamear en cada "Mi viaje".
    if chat_data is not None and not chat_data.get("teclado_refrescado"):
        chat_data["teclado_refrescado"] = True
        await bot.send_message(
            chat_id=chat_id,
            text=t(chofer, "menu_recordatorio"),
            reply_markup=menu_keyboard(chofer),
        )


def menu_keyboard(chofer):
    """Teclado persistente con accesos rápidos para el chófer.

    2026-07-23, feedback real probando en móvil: los 3 botones en una sola
    fila se veían pequeños y "Contactar gestor" se cortaba ("Contactar G").
    Una fila por botón -- cada uno ocupa el ancho completo, más fácil de
    pulsar con el móvil en la mano/conduciendo, y ningún texto se corta."""
    return ReplyKeyboardMarkup(
        [[t(chofer, "btn_mi_viaje")], [t(chofer, "btn_incidencia")], [t(chofer, "btn_contactar")]],
        resize_keyboard=True,
    )


# Tipos de incidencia de UN TOQUE (2026-07-23, rediseño para que el chófer no
# tenga que escribir nada -- seguridad al volante). Los 3 más comunes en ruta
# se reportan con un solo botón; el 4º ("otra") abre captura por voz o texto.
# (clave_button, clave_descripcion_estandar) por tipo -- el tipo es la propia
# clave sin el prefijo, y se guarda en incidencia.tipo.
TIPOS_INCIDENCIA_RAPIDA = [
    ("averia", "btn_inc_averia", "inc_desc_averia"),
    ("retraso", "btn_inc_retraso", "inc_desc_retraso"),
    ("carga", "btn_inc_carga", "inc_desc_carga"),
]


def incidencia_keyboard(chofer):
    """Selector de tipo de incidencia de un toque (inline). Última fila: 'otra',
    que pide una nota de voz o un texto libre."""
    filas = [
        [InlineKeyboardButton(t(chofer, btn), callback_data=f"inc:{tipo}")]
        for tipo, btn, _desc in TIPOS_INCIDENCIA_RAPIDA
    ]
    filas.append([InlineKeyboardButton(t(chofer, "btn_inc_otra"), callback_data="inc:otra")])
    return InlineKeyboardMarkup(filas)


# Fase 23, Bloque A (23.A.2) -- anotaciones estructuradas de la mercancía al
# cerrar una entrega. DISCOVERY.md insight 14: sin esto, un descuento de fin
# de mes por "mercancía mojada" no se puede discutir porque nadie lo anotó en
# el momento. (clave, texto_boton) -- "bien" no genera evento, es "sin novedad".
TIPOS_ANOTACION_ENTREGA = [
    ("mercancia_mojada", "btn_anot_mojada"),
    ("mercancia_danada", "btn_anot_danada"),
    ("faltan_bultos", "btn_anot_faltan"),
    ("sello_ilegible", "btn_anot_sello"),
]


def anotacion_entrega_keyboard(chofer, hito_id):
    filas = [
        [InlineKeyboardButton(t(chofer, btn), callback_data=f"anot:{tipo}:{hito_id}")]
        for tipo, btn in TIPOS_ANOTACION_ENTREGA
    ]
    filas.append([InlineKeyboardButton(t(chofer, "btn_anot_bien"), callback_data=f"anot:bien:{hito_id}")])
    return InlineKeyboardMarkup(filas)


def contactar_keyboard(chofer):
    """2026-07-23: el usuario pidió explícitamente conservar la vía de
    llamada real para emergencias ("en caso de emergencia hablar por
    teléfono es clave"), aunque la vía principal ahora sea texto/voz
    capturado por el bot. Si el gestor tiene `telefono` (0060), se ofrece un
    botón de llamada directa (tel:) además del mensaje por bot."""
    r = supabase.table("gestor").select("telefono").eq("empresa_id", chofer["empresa_id"]).not_.is_("telefono", "null").limit(1).execute()
    if not r.data or not r.data[0].get("telefono"):
        return None
    telefono = r.data[0]["telefono"]
    return InlineKeyboardMarkup([[InlineKeyboardButton(t(chofer, "btn_llamar"), url=f"tel:{telefono}")]])


async def _enviar_mensaje_a_gestor(chofer, viaje_id, texto):
    """Núcleo de 'chófer -> gestor' (17.G.10, 2026-07-23): registra en
    `mensaje_chofer` (buzón, entrega inmediata -- se marca `entregado_en` ya
    mismo porque `notificar_gestor_evento` empuja el Telegram en el momento,
    no hace falta esperar al job de 30s como en la dirección contraria) Y en
    `contexto` (corpus buscable del viaje/chófer). Antes 'Contactar' solo
    enseñaba un email -- nada de lo hablado quedaba capturado en ningún sitio."""
    from datetime import datetime, timezone
    supabase.table("mensaje_chofer").insert({
        "empresa_id": chofer["empresa_id"],
        "viaje_id": viaje_id,
        "chofer_id": chofer["id"],
        "direccion": "chofer_a_gestor",
        "texto": texto,
        "entregado_en": datetime.now(timezone.utc).isoformat(),
    }).execute()

    if viaje_id:
        supabase.table("contexto").insert({
            "empresa_id": chofer["empresa_id"], "entidad": "viaje", "entidad_id": viaje_id,
            "canal": "mensaje_gestor", "texto": texto, "autor_externo": chofer["nombre"],
        }).execute()

    notificados = await notificar_gestor_evento(
        chofer["empresa_id"], viaje_id,
        f"💬 {chofer['nombre']}: {texto}",
        tipo_notif="incidencias",  # mensajes del chófer son urgentes con más frecuencia que rutinarios
    )
    return notificados


async def handle_menu_texto(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Enruta la pulsación de uno de los botones del menú persistente."""
    chat_id = str(update.effective_chat.id)

    # 18.D.7: el mismo bot atiende a chóferes Y gestores, diferenciando por
    # quién escribe (mismo patrón que ya existía para chofer vs. vincular_gestor
    # en cmd_start) -- si hay un /cotizar en curso para este chat, el texto es
    # la respuesta a esa pregunta, no un botón de menú de chófer.
    cotizacion_en_curso = ctx.chat_data.get("cotizacion")
    if cotizacion_en_curso:
        await _procesar_paso_cotizacion(update, ctx, cotizacion_en_curso)
        return

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        return

    texto = update.message.text
    es_boton_menu = texto in BOTONES_INCIDENCIA or texto in BOTONES_MI_VIAJE or texto in BOTONES_CONTACTAR

    # Si el chófer pulsó "otra" en el selector de incidencia, el SIGUIENTE texto
    # (que no sea un botón del menú) es la descripción de esa incidencia. Se
    # comprueba ANTES que los botones para que "avería en la M-30" no se pierda.
    pend = ctx.chat_data.get("incidencia_libre")
    if pend and pend.get("hasta", 0) >= time.time() and not es_boton_menu:
        ctx.chat_data.pop("incidencia_libre", None)
        await _reportar_incidencia(update, ctx, chofer, "otra", texto)
        return
    ctx.chat_data.pop("incidencia_libre", None)

    # Igual para "Contactar gestor" (17.G.10): el texto que mande justo
    # después de pulsar el botón es el mensaje para el gestor, no algo que
    # tengamos que interpretar más.
    pend_contacto = ctx.chat_data.get("contactar_pendiente")
    if pend_contacto and pend_contacto.get("hasta", 0) >= time.time() and not es_boton_menu:
        ctx.chat_data.pop("contactar_pendiente", None)
        await _enviar_mensaje_a_gestor(chofer, pend_contacto.get("viaje_id"), texto)
        await update.message.reply_text(t(chofer, "mensaje_gestor_ok"), reply_markup=menu_keyboard(chofer))
        return
    ctx.chat_data.pop("contactar_pendiente", None)

    if texto in BOTONES_INCIDENCIA:
        await update.message.reply_text(t(chofer, "inc_elige"), reply_markup=incidencia_keyboard(chofer))
    elif texto in BOTONES_MI_VIAJE:
        await send_next_hito(chat_id, chofer, ctx.bot, ctx.chat_data)
    elif texto in BOTONES_CONTACTAR:
        viaje_r = supabase.table("viaje").select("id").eq("chofer_id", chofer["id"]).eq("estado", "en_curso").execute()
        viaje_id = viaje_r.data[0]["id"] if viaje_r.data else None
        ctx.chat_data["contactar_pendiente"] = {"hasta": time.time() + INCIDENCIA_FOTO_VENTANA_S, "viaje_id": viaje_id}
        await update.message.reply_text(t(chofer, "contactar_prompt"), reply_markup=contactar_keyboard(chofer))


async def vincular_gestor(update: Update, gestor_id: str, chat_id: str):
    """Vincula la cuenta de Telegram de un GESTOR (no chófer) para que reciba
    alertas. Enlace generado en /ajustes del dashboard: t.me/Bot?start=gestor_<id>
    """
    result = supabase.table("gestor").select("*").eq("id", gestor_id).execute()

    if not result.data:
        await update.message.reply_text(
            "No encuentro esa cuenta de gestor.\n"
            "Genera el enlace de nuevo desde Ajustes en el dashboard."
        )
        return

    gestor = result.data[0]

    if gestor.get("telegram_chat_id") and gestor["telegram_chat_id"] != chat_id:
        await update.message.reply_text(
            "Esta cuenta de gestor ya está vinculada a otro Telegram.\n"
            "Genera un enlace nuevo desde Ajustes si quieres cambiarlo."
        )
        return

    supabase.table("gestor").update({"telegram_chat_id": chat_id}).eq("id", gestor_id).execute()

    nombre = gestor.get("nombre", "gestor")
    await update.message.reply_text(
        f"Vinculado correctamente, {nombre}.\n"
        "A partir de ahora recibirás aquí las alertas de incidencias, entregas y avisos de Norenty."
    )
    logger.info("Gestor %s vinculado al chat %s", gestor_id, chat_id, extra={"gestor_id": gestor_id, "chat_id": chat_id})


async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)
    args = ctx.args

    if not args:
        await update.message.reply_text(
            "Hola, soy el bot de Norenty.\n\n"
            "Para vincularte, abre el enlace que te dio tu gestor "
            "(pulsa 'Abrir Telegram' en su pantalla) — se vincula solo, "
            "no tienes que escribir nada."
        )
        return

    codigo = args[0]

    if codigo.startswith("gestor_"):
        await vincular_gestor(update, codigo[len("gestor_"):], chat_id)
        return

    if len(codigo) != 36:
        await update.message.reply_text("Código no válido. Debe ser el UUID que te dio tu gestor.")
        return

    result = supabase.table("chofer").select("*").eq("id", codigo).execute()

    if not result.data:
        await update.message.reply_text(
            "No encuentro ese código de chófer.\n"
            "Comprueba con tu gestor que el código sea correcto."
        )
        return

    chofer = result.data[0]

    if chofer.get("chat_id") and chofer["chat_id"] != chat_id:
        await update.message.reply_text(
            "Este código ya está vinculado a otro Telegram.\n"
            "Contacta con tu gestor si crees que es un error."
        )
        return

    # Hallazgo real (2026-07-22, smoke test en vivo): `chofer.chat_id` tiene
    # UNIQUE en BD (un mismo Telegram no puede representar a dos chóferes a la
    # vez -- si no, get_chofer_by_chat no sabría a cuál responder). Sin este
    # chequeo previo, intentar vincular un Telegram ya usado por OTRO chófer
    # revienta el UPDATE con un IntegrityError sin capturar, que cae en el
    # manejador de errores genérico y responde el "problema técnico" opaco en
    # vez de explicar qué pasó de verdad.
    ya_vinculado = supabase.table("chofer").select("id, nombre").eq("chat_id", chat_id).execute()
    otro_chofer = next((c for c in (ya_vinculado.data or []) if c["id"] != codigo), None)
    if otro_chofer:
        await update.message.reply_text(
            f"Tu Telegram ya está vinculado a otro chófer ({otro_chofer['nombre']}).\n"
            "Contacta con tu gestor si quieres cambiarlo."
        )
        return

    supabase.table("chofer").update({"chat_id": chat_id}).eq("id", codigo).execute()

    nombre = chofer.get("nombre", "chófer")
    idioma = chofer.get("idioma", "es").upper()

    await update.message.reply_text(
        f"Vinculado correctamente, {nombre}.\nIdioma: {idioma}\n\n"
        "Comparte tu ubicación en tiempo real (clip 📎 → Ubicación → Compartir en tiempo real) "
        "para activar la llegada automática.",
        reply_markup=menu_keyboard(chofer),
    )

    logger.info(
        "Chofer %s vinculado al chat %s", codigo, chat_id,
        extra={"chofer_id": codigo, "chat_id": chat_id, "empresa_id": chofer.get("empresa_id")},
    )
    await send_next_hito(chat_id, chofer, ctx.bot, ctx.chat_data)


# Fase 23, Bloque C (23.C.3) — Operaciones de patio: enganchar/soltar un
# remolque desde Telegram, con el mínimo de fricción posible (el chófer
# "no sabe ni marcar llegadas", DISCOVERY.md insight 21 -- se confirma con
# UN comando y su matrícula, no con un formulario). Cada operación escribe
# en `acoplamiento` (0069) y por tanto entra en la cadena de evidencia.
def _acoplamientos_vigentes_de_chofer(chofer_id):
    r = ejecutar_con_reintentos(
        lambda: supabase.table("acoplamiento")
        .select("id, tractora_id, remolque_id, posicion")
        .eq("chofer_id", chofer_id)
        .is_("hasta", "null")
        .execute(),
        contexto={"accion": "acoplamientos_vigentes_de_chofer", "chofer_id": chofer_id},
    )
    return r.data or []


def _tractora_actual_de_chofer(chofer_id, empresa_id):
    """La tractora con la que trabaja el chófer ahora mismo. Un cambio de
    REMOLQUE (soltar/enganchar) no significa que el chófer haya cambiado de
    TRACTORA -- son dos cosas distintas que el esquema no separa en entidades
    propias, así que aquí se resuelve con tres niveles, del más al menos
    directo:
    1. Acoplamiento VIGENTE con tractora (caso normal, ya enganchado a algo).
    2. Su último acoplamiento CERRADO con tractora (acaba de soltar un
       remolque pero sigue con la misma tractora -- éste es el caso que
       encontró el test de la lanzadera: sin él, soltar un remolque hacía
       "olvidar" con qué tractora iba el chófer).
    3. El viaje en curso (`viaje.vehiculo_id`, dato heredado pre-0069), para
       un chófer que todavía no tiene ningún acoplamiento registrado.
    """
    propios = [a for a in ejecutar_con_reintentos(
        lambda: supabase.table("acoplamiento")
        .select("tractora_id, desde")
        .eq("chofer_id", chofer_id)
        .not_.is_("tractora_id", "null")
        .order("desde", desc=True)
        .limit(1)
        .execute(),
        contexto={"accion": "ultimo_acoplamiento_con_tractora", "chofer_id": chofer_id},
    ).data]
    if propios:
        return propios[0]["tractora_id"]

    r = ejecutar_con_reintentos(
        lambda: supabase.table("viaje")
        .select("vehiculo_id")
        .eq("chofer_id", chofer_id)
        .eq("empresa_id", empresa_id)
        .eq("estado", "en_curso")
        .not_.is_("vehiculo_id", "null")
        .limit(1)
        .execute(),
        contexto={"accion": "tractora_actual_de_chofer_fallback", "chofer_id": chofer_id},
    )
    return r.data[0]["vehiculo_id"] if r.data else None


def _buscar_remolque_por_matricula(empresa_id, matricula):
    r = ejecutar_con_reintentos(
        lambda: supabase.table("vehiculo")
        .select("id, matricula")
        .eq("empresa_id", empresa_id)
        .eq("tipo", "remolque")
        .ilike("matricula", matricula.strip())
        .limit(1)
        .execute(),
        contexto={"accion": "buscar_remolque_por_matricula", "matricula": matricula},
    )
    return r.data[0] if r.data else None


async def cmd_remolque(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/remolque -- muestra el estado actual (tractora + remolques acoplados).
    /remolque soltar MATRICULA -- desengancha ese remolque (queda suelto, sin
      tractora, "congelado" en su última posición conocida -- 23.C.2).
    /remolque enganchar MATRICULA -- engancha ese remolque a la tractora actual
      del chófer, en la primera posición libre (1, o 2 si ya lleva otro -- duo).
    """
    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await update.message.reply_text(t("es", "no_vinculado"))
        return

    args = ctx.args or []
    if not args:
        vigentes = _acoplamientos_vigentes_de_chofer(chofer["id"])
        if not vigentes:
            await update.message.reply_text(
                "No tienes ningún remolque acoplado registrado.\n"
                "Para enganchar uno: /remolque enganchar MATRICULA"
            )
            return
        lineas = ["Remolques acoplados ahora:"]
        for a in vigentes:
            veh = supabase.table("vehiculo").select("matricula").eq("id", a["remolque_id"]).execute()
            matricula = veh.data[0]["matricula"] if veh.data else a["remolque_id"][:8]
            lineas.append(f"· {matricula} (posición {a['posicion']})")
        lineas.append("\nPara soltar uno: /remolque soltar MATRICULA")
        await update.message.reply_text("\n".join(lineas))
        return

    accion = args[0].lower()
    matricula = " ".join(args[1:]).strip()
    if accion not in ("soltar", "enganchar") or not matricula:
        await update.message.reply_text(
            "Uso: /remolque soltar MATRICULA  ó  /remolque enganchar MATRICULA"
        )
        return

    remolque = _buscar_remolque_por_matricula(chofer["empresa_id"], matricula)
    if not remolque:
        await update.message.reply_text(f"No encuentro ningún remolque con matrícula {matricula}.")
        return

    ahora_iso = datetime.now(timezone.utc).isoformat()

    if accion == "soltar":
        vigente = ejecutar_con_reintentos(
            lambda: supabase.table("acoplamiento")
            .select("id")
            .eq("remolque_id", remolque["id"])
            .eq("chofer_id", chofer["id"])
            .is_("hasta", "null")
            .limit(1)
            .execute(),
            contexto={"accion": "acoplamiento_a_soltar", "remolque_id": remolque["id"]},
        )
        if not vigente.data:
            await update.message.reply_text(f"El remolque {remolque['matricula']} no está acoplado a ti ahora mismo.")
            return
        ejecutar_con_reintentos(
            lambda: supabase.table("acoplamiento")
            .update({"hasta": ahora_iso, "motivo": "suelta"})
            .eq("id", vigente.data[0]["id"])
            .execute(),
            contexto={"accion": "soltar_remolque", "acoplamiento_id": vigente.data[0]["id"]},
        )
        await update.message.reply_text(f"✅ Remolque {remolque['matricula']} soltado. Queda registrado como suelto.")
        return

    # accion == "enganchar"
    # Si el remolque venía acoplado a otro sitio (a otro chófer/tractora, o
    # suelto), se cierra ese acoplamiento primero -- el índice único de 0069
    # lo exigiría igualmente, pero así el mensaje al chófer es claro y no un
    # error de base de datos crudo.
    anterior = ejecutar_con_reintentos(
        lambda: supabase.table("acoplamiento").select("id, chofer_id").eq("remolque_id", remolque["id"]).is_("hasta", "null").limit(1).execute(),
        contexto={"accion": "acoplamiento_anterior_remolque", "remolque_id": remolque["id"]},
    )
    if anterior.data:
        ejecutar_con_reintentos(
            lambda: supabase.table("acoplamiento").update({"hasta": ahora_iso, "motivo": "cambio"}).eq("id", anterior.data[0]["id"]).execute(),
            contexto={"accion": "cerrar_acoplamiento_anterior", "acoplamiento_id": anterior.data[0]["id"]},
        )

    tractora_id = _tractora_actual_de_chofer(chofer["id"], chofer["empresa_id"])
    posiciones_ocupadas = {a["posicion"] for a in _acoplamientos_vigentes_de_chofer(chofer["id"]) if a.get("tractora_id") == tractora_id}
    posicion = 2 if 1 in posiciones_ocupadas else 1

    ejecutar_con_reintentos(
        lambda: supabase.table("acoplamiento").insert({
            "empresa_id": chofer["empresa_id"],
            "tractora_id": tractora_id,
            "remolque_id": remolque["id"],
            "posicion": posicion,
            "chofer_id": chofer["id"],
            "motivo": "enganche",
            "registrado_por": "bot",
        }).execute(),
        contexto={"accion": "enganchar_remolque", "remolque_id": remolque["id"], "chofer_id": chofer["id"]},
    )
    await update.message.reply_text(f"✅ Remolque {remolque['matricula']} enganchado (posición {posicion}).")


async def cmd_estado(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)

    if not chofer:
        await update.message.reply_text(t("es", "no_vinculado"))
        return

    await send_next_hito(chat_id, chofer, ctx.bot, ctx.chat_data)


async def cb_pre_llegada(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    hito_id = query.data.split(":")[1]
    chat_id = str(query.message.chat_id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await query.edit_message_text(t("es", "no_vinculado"))
        return

    hito, error = verificar_hito_pertenece_a_chofer(hito_id, chofer["id"])
    if error:
        await query.edit_message_text(error)
        return

    tipo_t = t(chofer, "hito_recogida").lower() if hito["tipo"] == "recogida" else t(chofer, "hito_entrega").lower()
    direccion = hito.get("direccion", "?")

    await query.edit_message_text(
        text=t(chofer, "confirmar_llegada", tipo=tipo_t, dir=direccion),
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton(t(chofer, "btn_confirmar"), callback_data=f"llegada:{hito_id}"),
                InlineKeyboardButton(t(chofer, "btn_cancelar"), callback_data="cancelar"),
            ]
        ]),
    )


async def cb_llegada(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    hito_id = query.data.split(":")[1]
    chat_id = str(query.message.chat_id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await query.edit_message_text(t("es", "no_vinculado"))
        return

    hito, error = verificar_hito_pertenece_a_chofer(hito_id, chofer["id"])
    if error:
        await query.edit_message_text(error)
        return

    chofer_id = chofer["id"]
    viaje = hito["viaje"]

    # La llegada es el dato más importante del sistema (es lo que el negocio
    # vende): con reintentos, no se pierde por un blip de red.
    contexto_llegada = {"accion": "confirmar_llegada", "hito_id": hito_id, "chofer_id": chofer_id}
    ejecutar_con_reintentos(
        lambda: supabase.table("hito").update({"estado": "en_curso"}).eq("id", hito_id).execute(),
        contexto=contexto_llegada,
    )
    ejecutar_con_reintentos(
        lambda: supabase.table("ejecucion_evento").insert({
            "viaje_id": viaje["id"],
            "hito_id": hito_id,
            "chofer_id": chofer_id,
            "tipo": "llegada",
            "detalle": hito.get("direccion"),
        }).execute(),
        contexto=contexto_llegada,
    )

    # Comprobar si llegó fuera de ventana
    if hito.get("ventana_fin"):
        from datetime import datetime, timezone
        try:
            ventana_fin = datetime.fromisoformat(hito["ventana_fin"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > ventana_fin:
                ref = viaje.get("referencia") or viaje["id"][:8]
                # R1 (2026-07-15): si monitor_retraso_silencioso.py ya detectó
                # y avisó de este hito ANTES de que el chófer confirmara, no
                # duplicar el aviso -- solo cerrar esa incidencia (el
                # "silencio" acaba de terminar). Si no había ninguna abierta
                # (el chófer confirmó tarde antes de que el monitor llegara a
                # correr), se mantiene el aviso reactivo de siempre.
                existente_r = (
                    supabase.table("incidencia")
                    .select("id")
                    .eq("hito_id", hito_id)
                    .eq("tipo", "fuera_de_ventana")
                    .eq("estado", "abierta")
                    .execute()
                )
                if existente_r.data:
                    supabase.table("incidencia").update({
                        "estado": "resuelta",
                        "resuelta_en": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", existente_r.data[0]["id"]).execute()
                else:
                    await alertar_gestor(
                        chofer["empresa_id"],
                        viaje["id"],
                        "fuera_de_ventana",
                        f"Chófer {chofer['nombre']} llegó fuera de ventana al hito {hito['orden']} ({hito.get('direccion', '?')}) del viaje {ref}.",
                    )
        except (ValueError, TypeError):
            pass

    logger.info(
        "Llegada registrada: hito %s, chofer %s", hito_id, chofer_id,
        extra={"hito_id": hito_id, "chofer_id": chofer_id, "viaje_id": viaje.get("id"), "empresa_id": chofer.get("empresa_id")},
    )

    dir_hito = hito.get("direccion", "?")
    if hito["tipo"] == "entrega":
        if empresa_requiere_pod(chofer["empresa_id"]):
            # 2026-07-23, feedback real: "requiere_pod" era todo o nada por
            # empresa -- si el chófer llega sin foto a mano (le pasa a
            # cualquiera: batería, cliente sin recibir aún el albarán físico,
            # etc.) se quedaba bloqueado sin ninguna salida. Un botón para
            # saltarlo POR ESE VIAJE, dejando aviso al gestor para revisar,
            # en vez de tener que desactivar la exigencia para toda la
            # empresa (lo que sí ocurrió por accidente durante el smoke test).
            await query.edit_message_text(
                t(chofer, "pedir_foto", dir=dir_hito),
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton(t(chofer, "btn_sin_foto"), callback_data=f"sin_pod:{hito_id}"),
                ]]),
            )
        else:
            # Toggle "requiere_pod" desactivado: la entrega se completa sola,
            # sin pedir foto de albarán (mismo patrón que la recogida de abajo).
            supabase.table("hito").update({"estado": "completado"}).eq("id", hito_id).execute()
            supabase.table("ejecucion_evento").insert({
                "viaje_id": viaje["id"],
                "hito_id": hito_id,
                "chofer_id": chofer_id,
                "tipo": "salida",
            }).execute()

            await query.edit_message_text(t(chofer, "entrega_ok", dir=dir_hito))

            ref = viaje.get("referencia") or viaje["id"][:8]
            await notificar_gestor_evento(
                chofer["empresa_id"],
                viaje["id"],
                f"✅ Entrega completada (sin albarán) — Viaje {ref}, hito {hito['orden']} ({dir_hito}). Chófer: {chofer['nombre']}.",
            )
            await send_next_hito(chat_id, chofer, ctx.bot, ctx.chat_data)
    else:
        supabase.table("hito").update({"estado": "completado"}).eq("id", hito_id).execute()
        supabase.table("ejecucion_evento").insert({
            "viaje_id": viaje["id"],
            "hito_id": hito_id,
            "chofer_id": chofer_id,
            "tipo": "salida",
        }).execute()

        await query.edit_message_text(t(chofer, "recogida_ok", dir=dir_hito))
        await send_next_hito(chat_id, chofer, ctx.bot, ctx.chat_data)


async def cb_cancelar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    chat_id = str(query.message.chat_id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await query.edit_message_text(t("es", "no_vinculado"))
        return

    await query.edit_message_text(t(chofer, "cancelado"))
    await send_next_hito(chat_id, chofer, ctx.bot, ctx.chat_data)


async def handle_location(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Guarda la ubicación del chófer (incluida live location editada, que
    Telegram manda como `edited_message`) y, si está a menos de
    UMBRAL_GEO_LLEGADA_M del hito pendiente más próximo en su ruta, le
    pregunta proactivamente si ha llegado (ítem 7A.4). NO auto-confirma la
    llegada en v1 — sigue exigiendo el botón de confirmar de siempre
    (`cb_pre_llegada`, ya registrado), es solo la PREGUNTA la que se dispara
    sola. Silencioso en cualquier otro caso: live location manda updates cada
    pocos segundos y no hay nada útil que responder la mayoría de las veces.
    """
    msg = update.message or update.edited_message
    if not msg or not msg.location:
        return

    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        return

    lat, lon = msg.location.latitude, msg.location.longitude

    # UBI.1: sub-muestrear la ESCRITURA (la detección de geo-llegada de abajo
    # sigue evaluando este ping siempre, sub-muestrear solo ahorraría lo
    # barato y no lo caro). Silencioso si no hace falta guardar.
    ultimo_r = (
        supabase.table("ubicacion")
        .select("lat, lon, created_at")
        .eq("chofer_id", chofer["id"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    ultimo_punto = ultimo_r.data[0] if ultimo_r.data else None
    if debe_guardar_ubicacion(ultimo_punto, lat, lon):
        supabase.table("ubicacion").insert({"chofer_id": chofer["id"], "lat": lat, "lon": lon}).execute()

    viaje_r = (
        supabase.table("viaje")
        .select("id")
        .eq("chofer_id", chofer["id"])
        .eq("estado", "en_curso")
        .execute()
    )
    if not viaje_r.data:
        return

    viaje_id = viaje_r.data[0]["id"]
    hitos_r = (
        supabase.table("hito")
        .select("id, orden, lat, lon, direccion, estado, es_checkpoint, radio_m")
        .eq("viaje_id", viaje_id)
        .order("orden")
        .execute()
    )
    hitos = hitos_r.data or []

    # CHK.4: los checkpoints se comprueban SIEMPRE (no dependen de que haya
    # hitos pendientes ni de la distancia al más próximo, a diferencia de la
    # pregunta de geo-llegada de abajo). Silencioso, sin mensaje al chófer —
    # es aseguramiento pasivo, no exige confirmación.
    checkpoints = [
        h for h in hitos
        if h.get("es_checkpoint") and h.get("lat") is not None and h.get("lon") is not None
    ]
    for cp in checkpoints:
        if not punto_en_checkpoint(lat, lon, cp):
            continue
        ya_r = (
            supabase.table("ejecucion_evento")
            .select("id")
            .eq("hito_id", cp["id"])
            .eq("tipo", "checkpoint_pasado")
            .execute()
        )
        if ya_r.data:
            continue
        supabase.table("ejecucion_evento").insert({
            "viaje_id": viaje_id,
            "hito_id": cp["id"],
            "chofer_id": chofer["id"],
            "tipo": "checkpoint_pasado",
            "detalle": cp.get("direccion"),
        }).execute()

    # F13.5: aviso proactivo de pausa legal (561) -- una vez por viaje,
    # independiente de la lógica de geo-llegada de abajo.
    if ctx.chat_data.get("aviso_pausa_561_viaje") != viaje_id:
        inicio_r = (
            supabase.table("ejecucion_evento")
            .select("ocurrido_en")
            .eq("viaje_id", viaje_id)
            .order("ocurrido_en")
            .limit(1)
            .execute()
        )
        inicio = inicio_r.data[0].get("ocurrido_en") if inicio_r.data else None
        if inicio:
            emp_r = supabase.table("empresa").select("velocidad_planificacion_kmh").eq("id", chofer["empresa_id"]).execute()
            velocidad = (emp_r.data[0].get("velocidad_planificacion_kmh") if emp_r.data else None) or VELOCIDAD_PLANIFICACION_KMH_DEFAULT
            horas = await horas_conduccion_estimadas_viaje(chofer["id"], inicio, velocidad)
            if debe_avisar_pausa(horas, False):
                ctx.chat_data["aviso_pausa_561_viaje"] = viaje_id
                await ctx.bot.send_message(chat_id=chat_id, text=t(chofer, "aviso_pausa_561"))

    pendientes = [
        h for h in hitos
        if h.get("estado") == "pendiente" and h.get("lat") is not None and h.get("lon") is not None
    ]
    if not pendientes:
        return

    hito = pendientes[0]
    distancia_m = haversine_km(lat, lon, hito["lat"], hito["lon"]) * 1000
    if distancia_m > UMBRAL_GEO_LLEGADA_M:
        return

    if ctx.chat_data.get("geo_preguntado") == hito["id"]:
        return
    ctx.chat_data["geo_preguntado"] = hito["id"]

    await ctx.bot.send_message(
        chat_id=chat_id,
        text=t(chofer, "geo_llegada_pregunta", dir=hito.get("direccion") or t(chofer, "hito_sin_dir")),
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton(t(chofer, "btn_llegado"), callback_data=f"pre_llegada:{hito['id']}")]
        ]),
    )


# 11.3 (Nivel 1 escalera de captura): `contexto.texto` es NOT NULL (0042), asi
# que una nota de voz sin transcribir guarda este marcador hasta que Whisper
# (gated por deploy + 11.5) lo reemplace retroactivamente con la transcripcion
# real. Buscar por este valor = "audios pendientes de transcribir".
MARCADOR_NOTA_VOZ_SIN_TRANSCRIBIR = "[nota de voz sin transcribir]"

INCIDENCIA_FOTO_VENTANA_S = 300  # F14.6: margen para adjuntar foto tras /incidencia antes de
# que la siguiente foto que mande el chófer se trate como un POD normal en vez de "la foto de
# la incidencia que reportó hace un rato" (evita mezclar dos fotos de contextos distintos).


async def _subir_foto_incidencia(update, ctx, chofer, incidencia_id, viaje_id):
    """F14.6 (2026-07-17): igual que el POD (hash de integridad antes de subir, mismo bucket
    privado "pods" -- reutilizado porque su RLS ya scopa por empresa_id en el primer segmento
    de carpeta, ver 0057), pero sobre `incidencia` en vez de `pod`/`hito`: no hay hito que
    completar, es solo evidencia adjunta a lo que el chófer ya reportó por texto."""
    photo = update.message.photo[-1]
    file = await ctx.bot.get_file(photo.file_id)
    file_bytes = await file.download_as_bytearray()

    valida, motivo = _foto_pod_valida(file_bytes)
    if not valida:
        await update.message.reply_text(t(chofer, motivo))
        return

    file_path = f"{chofer['empresa_id']}/incidencia/{incidencia_id}/{uuid.uuid4()}.jpg"
    hash_sha256 = hashlib.sha256(bytes(file_bytes)).hexdigest()

    supabase.storage.from_("pods").upload(
        path=file_path,
        file=bytes(file_bytes),
        file_options={"content-type": "image/jpeg"},
    )
    supabase.table("incidencia").update({
        "foto_url": file_path,
        "foto_hash_sha256": hash_sha256,
    }).eq("id", incidencia_id).execute()

    await update.message.reply_text(t(chofer, "incidencia_foto_ok"))
    logger.info(
        "Foto adjuntada a incidencia %s (viaje %s)", incidencia_id, viaje_id,
        extra={"incidencia_id": incidencia_id, "viaje_id": viaje_id, "chofer_id": chofer["id"]},
    )


async def handle_voice(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Nivel 1 de la escalera de captura de conocimiento (ROADMAP Fase 11, 11.3).

    El valor del producto esta en las EXCEPCIONES, que hoy se resuelven por
    telefono y el sistema no ve. Este es el peldano mas barato: el chofer manda
    una nota de voz y queda anclada al viaje en curso como `contexto` (11.2),
    con su hash de integridad (misma tesis de evidencia que POD/incidencia/gasto).

    DELIBERADAMENTE SIN TRANSCRIPCION NI CLASIFICACION: la taxonomia de urgencia
    y tipo la cierra el discovery con el gestor; hard-codear una inventada
    obligaria a reescribirla. Guardar el audio NO depende de esa decision, empieza
    a acumular corpus hoy, y la transcripcion (Whisper self-host, gated por deploy
    + 11.5) se le pasa RETROACTIVAMENTE despues haciendo UPDATE de `texto` sobre
    las filas ya guardadas -- por eso `texto` guarda un marcador mientras tanto.
    """
    chat_id = str(update.effective_chat.id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await update.message.reply_text(t("es", "no_vinculado"))
        return

    viajes_r = ejecutar_con_reintentos(
        lambda: supabase.table("viaje")
        .select("id")
        .eq("chofer_id", chofer["id"])
        .eq("estado", "en_curso")
        .execute(),
        contexto={"accion": "handle_voice_viaje"},
    )
    if not viajes_r.data:
        # 2026-07-23: si estaba esperando el mensaje de "Contactar gestor", una
        # nota de voz vale igual aunque no haya viaje en curso (puede ser una
        # duda general, o el chófer ni siquiera ha arrancado ruta todavía) --
        # se transcribe/oye igual, no depende de tener un viaje activo como sí
        # depende la nota de voz "normal" anclada al viaje.
        pend_contacto = ctx.chat_data.get("contactar_pendiente")
        if pend_contacto and pend_contacto.get("hasta", 0) >= time.time():
            ctx.chat_data.pop("contactar_pendiente", None)
            await _enviar_mensaje_a_gestor(chofer, None, "nota de voz (sin viaje activo)")
            await update.message.reply_text(t(chofer, "mensaje_gestor_ok"), reply_markup=menu_keyboard(chofer))
            return
        await update.message.reply_text(t(chofer, "nota_voz_sin_viaje"))
        return

    viaje_id = viajes_r.data[0]["id"]

    voice = update.message.voice
    file = await ctx.bot.get_file(voice.file_id)
    file_bytes = await file.download_as_bytearray()

    # Hash ANTES de subir, igual que POD (9.8) e incidencia (F14.6): el hash es
    # del audio real que llego del chofer, no de una copia ya en Storage.
    hash_sha256 = hashlib.sha256(bytes(file_bytes)).hexdigest()
    file_path = f"{chofer['empresa_id']}/voz/{viaje_id}/{uuid.uuid4()}.ogg"

    supabase.storage.from_("pods").upload(
        path=file_path,
        file=bytes(file_bytes),
        file_options={"content-type": "audio/ogg"},
    )
    supabase.table("contexto").insert({
        "empresa_id": chofer["empresa_id"],
        "entidad": "viaje",
        "entidad_id": viaje_id,
        "canal": "nota_voz",
        "texto": MARCADOR_NOTA_VOZ_SIN_TRANSCRIBIR,
        "autor_externo": chofer["nombre"],
        "audio_url": file_path,
        "audio_hash_sha256": hash_sha256,
    }).execute()

    await update.message.reply_text(t(chofer, "nota_voz_ok"))
    logger.info(
        "Nota de voz guardada en viaje %s", viaje_id,
        extra={"viaje_id": viaje_id, "chofer_id": chofer["id"]},
    )

    # 2026-07-23: si el chófer pulsó "otra" en el selector de incidencia y la
    # respondió con una nota de voz, además de guardarla como contexto (arriba)
    # se abre una incidencia real para que el gestor reciba un AVISO -- si no,
    # la nota de voz quedaría solo en el timeline del viaje y podría pasar
    # desapercibida justo cuando es una urgencia. La transcripción llegará
    # después (Whisper); de momento el gestor sabe que hay un audio que oír.
    pend = ctx.chat_data.get("incidencia_libre")
    if pend and pend.get("hasta", 0) >= time.time():
        ctx.chat_data.pop("incidencia_libre", None)
        await _reportar_incidencia(update, ctx, chofer, "otra", "nota de voz (escúchala en el viaje)")
        return

    pend_contacto = ctx.chat_data.get("contactar_pendiente")
    if pend_contacto and pend_contacto.get("hasta", 0) >= time.time():
        ctx.chat_data.pop("contactar_pendiente", None)
        await _enviar_mensaje_a_gestor(chofer, viaje_id, "nota de voz (escúchala en el viaje)")
        await update.message.reply_text(t(chofer, "mensaje_gestor_ok"), reply_markup=menu_keyboard(chofer))


async def handle_photo(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await update.message.reply_text(t("es", "no_vinculado"))
        return

    chofer_id = chofer["id"]

    # F14.6: si el chófer acaba de reportar una incidencia y esto es la
    # primera foto que manda dentro de la ventana, es la foto de ESA
    # incidencia, no un POD -- se atiende aquí y se sale, sin tocar el flujo
    # de entrega de abajo.
    pendiente = ctx.chat_data.get("incidencia_pendiente_foto")
    if pendiente and pendiente.get("hasta", 0) >= time.time():
        ctx.chat_data.pop("incidencia_pendiente_foto", None)
        await _subir_foto_incidencia(update, ctx, chofer, pendiente["id"], pendiente["viaje_id"])
        return
    ctx.chat_data.pop("incidencia_pendiente_foto", None)

    viajes_r = (
        supabase.table("viaje")
        .select("id, referencia")
        .eq("chofer_id", chofer_id)
        .eq("estado", "en_curso")
        .execute()
    )
    if not viajes_r.data:
        await update.message.reply_text(t(chofer, "sin_viaje_activo"))
        return

    viaje = viajes_r.data[0]

    hito_r = (
        supabase.table("hito")
        .select("*")
        .eq("viaje_id", viaje["id"])
        .eq("estado", "en_curso")
        .eq("tipo", "entrega")
        .execute()
    )
    if not hito_r.data:
        await update.message.reply_text(t(chofer, "sin_entrega_esperando"))
        return

    hito = hito_r.data[0]

    await update.message.reply_text(t(chofer, "foto_subiendo"))

    photo = update.message.photo[-1]
    file = await ctx.bot.get_file(photo.file_id)
    file_bytes = await file.download_as_bytearray()

    # ítem 9.9: validar tamaño y firma (magic bytes) antes de subir nada —
    # nunca confiar en que "photo" de Telegram implica un JPEG válido.
    valida, motivo = _foto_pod_valida(file_bytes)
    if not valida:
        logger.warning(
            "Foto de POD rechazada (motivo=%s, tamaño=%d) para hito %s", motivo, len(file_bytes), hito["id"],
            extra={"hito_id": hito["id"], "viaje_id": viaje["id"], "chofer_id": chofer_id, "tamano_bytes": len(file_bytes), "motivo": motivo},
        )
        await update.message.reply_text(t(chofer, motivo))
        return

    # Ruta: {empresa_id}/{viaje_id}/{hito_id}/{uuid}.jpg
    # empresa_id como primer segmento permite RLS de storage empresa-scoped.
    file_path = f"{chofer['empresa_id']}/{viaje['id']}/{hito['id']}/{uuid.uuid4()}.jpg"

    # Hash de INTEGRIDAD (ítem 9.8, evidencia igual que el hash-chain de
    # ejecucion_evento): se calcula sobre los bytes tal cual llegan de
    # Telegram, ANTES de subir — así el hash guardado es el de la foto real,
    # no de una copia que ya haya podido tocarse en Storage.
    hash_sha256 = hashlib.sha256(bytes(file_bytes)).hexdigest()

    supabase.storage.from_("pods").upload(
        path=file_path,
        file=bytes(file_bytes),
        file_options={"content-type": "image/jpeg"},
    )

    supabase.table("pod").insert({
        "hito_id": hito["id"],
        "viaje_id": viaje["id"],
        "foto_url": file_path,
        "estado_validacion": "pendiente",
        "hash_sha256": hash_sha256,
    }).execute()

    supabase.table("hito").update({"estado": "completado"}).eq("id", hito["id"]).execute()

    supabase.table("ejecucion_evento").insert({
        "viaje_id": viaje["id"],
        "hito_id": hito["id"],
        "chofer_id": chofer_id,
        "tipo": "pod_subido",
    }).execute()

    supabase.table("ejecucion_evento").insert({
        "viaje_id": viaje["id"],
        "hito_id": hito["id"],
        "chofer_id": chofer_id,
        "tipo": "salida",
    }).execute()

    logger.info(
        "POD subido: hito %s", hito["id"],
        extra={"hito_id": hito["id"], "viaje_id": viaje["id"], "chofer_id": chofer_id, "empresa_id": chofer["empresa_id"]},
    )

    ref = viaje.get("referencia") or viaje["id"][:8]
    dir_hito = hito.get("direccion", "?")
    await update.message.reply_text(t(chofer, "pod_ok", dir=dir_hito))

    await notificar_gestor_evento(
        chofer["empresa_id"],
        viaje["id"],
        f"📄 Albarán recibido — Viaje {ref}, hito {hito['orden']} ({dir_hito}). Chófer: {chofer['nombre']}.",
    )

    # Fase 23, Bloque A (23.A.2) -- DISCOVERY.md insight 14: "mercancía llega
    # mojada... luego a fin de mes te descuentan y nadie sabe nada". Se
    # pregunta AQUÍ, con el chófer todavía en el muelle, no días después.
    await update.message.reply_text(t(chofer, "anot_pregunta"), reply_markup=anotacion_entrega_keyboard(chofer, hito["id"]))

    await send_next_hito(chat_id, chofer, ctx.bot, ctx.chat_data)


async def cb_sin_pod(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Chófer pulsa "No la tengo ahora" tras pedirle la foto de albarán
    (2026-07-23, feedback real: el toggle `empresa.requiere_pod` era la única
    salida y era todo-o-nada para la empresa entera). Completa la entrega SIN
    POD y dispara una incidencia (tipo "sin_pod") para que el gestor lo sepa y
    pueda pedir el albarán por otra vía (email, WhatsApp) -- no es "problema
    resuelto en silencio", es "resuelto sin evidencia, marcado para revisar"."""
    query = update.callback_query
    await query.answer()

    hito_id = query.data.split(":")[1]
    chat_id = str(query.message.chat_id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await query.edit_message_text(t("es", "no_vinculado"))
        return

    hito, error = verificar_hito_pertenece_a_chofer(hito_id, chofer["id"])
    if error:
        await query.edit_message_text(error)
        return

    chofer_id = chofer["id"]
    viaje = hito["viaje"]
    dir_hito = hito.get("direccion", "?")
    ref = viaje.get("referencia") or viaje["id"][:8]

    supabase.table("hito").update({"estado": "completado"}).eq("id", hito_id).execute()
    supabase.table("ejecucion_evento").insert({
        "viaje_id": viaje["id"], "hito_id": hito_id, "chofer_id": chofer_id, "tipo": "salida",
    }).execute()

    await alertar_gestor(
        chofer["empresa_id"],
        viaje["id"],
        "sin_pod",
        f"Entrega sin foto de albarán — Viaje {ref}, hito {hito['orden']} ({dir_hito}). "
        f"Chófer {chofer['nombre']} indicó que no la tenía en el momento. Pedir el albarán por otra vía.",
    )

    logger.info(
        "Entrega sin POD (saltada por el chófer): hito %s", hito_id,
        extra={"hito_id": hito_id, "viaje_id": viaje["id"], "chofer_id": chofer_id, "empresa_id": chofer["empresa_id"]},
    )

    await query.edit_message_text(t(chofer, "sin_pod_ok", dir=dir_hito))
    await query.message.reply_text(t(chofer, "anot_pregunta"), reply_markup=anotacion_entrega_keyboard(chofer, hito_id))
    await send_next_hito(chat_id, chofer, ctx.bot, ctx.chat_data)


async def _reportar_incidencia(update: Update, ctx: ContextTypes.DEFAULT_TYPE, chofer, tipo, descripcion):
    """Núcleo compartido de reporte de incidencia (2026-07-23): lo usan el
    selector de un toque (`cb_incidencia`), la captura de texto libre de "otra"
    y el comando `/incidencia` heredado. `tipo` va a `incidencia.tipo`,
    `descripcion` es lo que ve el gestor. Devuelve el id o None. Responde al
    chófer (confirmación + ventana de foto opcional) y avisa al gestor."""
    msg = update.message or (update.callback_query and update.callback_query.message)
    viajes_r = (
        supabase.table("viaje")
        .select("id, referencia")
        .eq("chofer_id", chofer["id"])
        .eq("estado", "en_curso")
        .execute()
    )
    if not viajes_r.data:
        await msg.reply_text(t(chofer, "sin_viaje_activo"))
        return None

    viaje = viajes_r.data[0]
    ref = viaje.get("referencia") or viaje["id"][:8]

    incidencia_id = await alertar_gestor(
        chofer["empresa_id"],
        viaje["id"],
        tipo,
        f"Reportado por chófer {chofer['nombre']}: {descripcion}",
    )

    await msg.reply_text(t(chofer, "incidencia_ok", ref=ref), reply_markup=menu_keyboard(chofer))
    # F14.6: la siguiente foto dentro de INCIDENCIA_FOTO_VENTANA_S se adjunta a
    # esta incidencia. Opcional -- no bloquea nada si no manda ninguna.
    if incidencia_id:
        ctx.chat_data["incidencia_pendiente_foto"] = {
            "id": incidencia_id,
            "viaje_id": viaje["id"],
            "hasta": time.time() + INCIDENCIA_FOTO_VENTANA_S,
        }
        await msg.reply_text(t(chofer, "incidencia_foto_pregunta"))
    logger.info(
        "Incidencia (%s): chofer %s, viaje %s", tipo, chofer["id"], viaje["id"],
        extra={"chofer_id": chofer["id"], "viaje_id": viaje["id"], "empresa_id": chofer["empresa_id"], "tipo_incidencia": tipo},
    )
    return incidencia_id


async def cb_incidencia(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Selector de tipo de incidencia de un toque (2026-07-23). Los 3 tipos
    rápidos reportan al instante con una descripción estándar; "otra" abre la
    captura por voz/texto (flag `incidencia_libre`)."""
    query = update.callback_query
    await query.answer()
    tipo = query.data.split(":")[1]
    chat_id = str(query.message.chat_id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await query.edit_message_text(t("es", "no_vinculado"))
        return

    if tipo == "otra":
        ctx.chat_data["incidencia_libre"] = {"hasta": time.time() + INCIDENCIA_FOTO_VENTANA_S}
        await query.edit_message_text(t(chofer, "inc_otra_prompt"))
        return

    desc_key = next((d for tp, _b, d in TIPOS_INCIDENCIA_RAPIDA if tp == tipo), None)
    if not desc_key:
        return
    # Quita los botones del mensaje anterior para que no se pueda pulsar dos veces.
    await query.edit_message_text(t(chofer, "inc_elige") + " ✓")
    await _reportar_incidencia(update, ctx, chofer, tipo, t(chofer, desc_key))


async def cb_anotacion_entrega(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Fase 23, 23.A.2 -- registra la anotación de mercancía elegida, en el
    momento, mientras el chófer sigue en el muelle. `tipo == "bien"` no
    genera evento (sin novedad no es un dato, es la ausencia de uno)."""
    query = update.callback_query
    await query.answer()

    _, tipo, hito_id = query.data.split(":")
    chat_id = str(query.message.chat_id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await query.edit_message_text(t("es", "no_vinculado"))
        return

    r = ejecutar_con_reintentos(
        lambda: supabase.table("hito").select("viaje_id").eq("id", hito_id).execute(),
        contexto={"accion": "anotacion_entrega_buscar_hito", "hito_id": hito_id},
    )
    if not r.data:
        await query.edit_message_text(t(chofer, "anot_pregunta"))
        return
    viaje_id = r.data[0]["viaje_id"]

    if tipo != "bien":
        ejecutar_con_reintentos(
            lambda: supabase.table("ejecucion_evento").insert({
                "viaje_id": viaje_id,
                "hito_id": hito_id,
                "chofer_id": chofer["id"],
                "tipo": "anotacion_entrega",
                "detalle": tipo,
            }).execute(),
            contexto={"accion": "registrar_anotacion_entrega", "hito_id": hito_id, "tipo": tipo},
        )
        await notificar_gestor_evento(
            chofer["empresa_id"], viaje_id,
            f"⚠️ Anotación en entrega — {t(chofer, TIPOS_ANOTACION_ENTREGA_DESC.get(tipo, tipo))}. Chófer: {chofer['nombre']}.",
        )

    await query.edit_message_text(t(chofer, "anot_registrada"))


TIPOS_ANOTACION_ENTREGA_DESC = {
    "mercancia_mojada": "btn_anot_mojada",
    "mercancia_danada": "btn_anot_danada",
    "faltan_bultos": "btn_anot_faltan",
    "sello_ilegible": "btn_anot_sello",
}


async def cmd_incidencia(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Comando heredado `/incidencia texto`. La vía principal ahora es el botón
    ⚠️ del menú (selector de un toque), pero se mantiene por si alguien escribe."""
    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await update.message.reply_text(t("es", "no_vinculado"))
        return

    texto = " ".join(ctx.args) if ctx.args else ""
    if not texto:
        # Sin texto: mostrar el selector de un toque, no pedir que escriban.
        await update.message.reply_text(t(chofer, "inc_elige"), reply_markup=incidencia_keyboard(chofer))
        return

    await _reportar_incidencia(update, ctx, chofer, "otro", texto)


# Mismo factor que dashboard/lib/data.js (FACTOR_SINUOSIDAD_FALLBACK). Decisión
# 2026-07-26: el negocio vende kilómetros, así que la precisión importa más
# que ahorrar unos segundos en la conversación -- el bot ahora intenta OSRM
# (distancia por carretera real) igual que el dashboard, y SOLO cae a este
# factor si OSRM no responde (self-host caído, tramo sin ruta, etc.).
FACTOR_SINUOSIDAD_FALLBACK = 1.3
OSRM_URL = os.environ.get("OSRM_URL", "http://localhost:5000")
VELOCIDAD_PLANIFICACION_KMH_DEFAULT = 75

# Distancia (metros) por debajo de la cual el bot pregunta proactivamente si el
# chófer ha llegado, al recibir su ubicación en vivo (ítem 7A.4). Valor inicial
# razonable, NO pactado con cliente real — ajustable.
UMBRAL_GEO_LLEGADA_M = 300

# UBI.1 — sub-muestreo de la ESCRITURA en `ubicacion` (decisión CTO 2026-07-14):
# Telegram empuja un ping cada ~15-60s durante live location; guardar todos
# llenaría la BD sin necesidad (~1.000 filas/chófer/día). La DETECCIÓN de
# geo-llegada (UMBRAL_GEO_LLEGADA_M, arriba) sigue evaluando CADA ping —
# barato, un haversine. Solo el guardado se espacia: no se guarda un punto
# nuevo antes de UMBRAL_UBICACION_INTERVALO_S desde el último de ESE chófer,
# SALVO que se haya movido más de UMBRAL_UBICACION_DISTANCIA_M (un giro o
# parada/arranque importa aunque sea pronto). Valores iniciales razonables,
# NO pactados con cliente real.
UMBRAL_UBICACION_INTERVALO_S = 120
UMBRAL_UBICACION_DISTANCIA_M = 200

# Reglamento (CE) 561/2006 — mismos límites y misma simplificación v1
# CONSERVADORA que calcularEtaConParadas() en dashboard/lib/data.js (siempre
# límite diario base 9h + descanso normal 11h, sin las excepciones de 10h/2x-
# semana ni descanso reducido 9h; no comprueba límites semanales/bisemanales —
# ver ese archivo para el razonamiento completo). Sobreestima, nunca infraestima.
_PAUSA_TRAS_HORAS = 4.5
_PAUSA_DURACION_H = 45 / 60
_CONDUCCION_DIARIA_MAX_H = 9
_DESCANSO_DIARIO_H = 11
_EPS = 1e-9


def calcular_eta_con_paradas(horas_conduccion_total):
    """Espejo en Python de calcularEtaConParadas() (dashboard/lib/data.js,
    ítem 5.3) — mismo algoritmo, mismos casos de test. Función PURA, sin red.

    @return dict con horas_totales, paradas_45min, descansos_11h.
    """
    restante = horas_conduccion_total
    desde_ultima_pausa = 0.0
    conduccion_hoy = 0.0
    horas_totales = 0.0
    paradas_45min = 0
    descansos_11h = 0

    while restante > _EPS:
        margen_pausa = _PAUSA_TRAS_HORAS - desde_ultima_pausa
        margen_dia = _CONDUCCION_DIARIA_MAX_H - conduccion_hoy
        tramo = min(restante, margen_pausa, margen_dia)

        horas_totales += tramo
        desde_ultima_pausa += tramo
        conduccion_hoy += tramo
        restante -= tramo

        if restante <= _EPS:
            break

        if conduccion_hoy >= _CONDUCCION_DIARIA_MAX_H - _EPS:
            horas_totales += _DESCANSO_DIARIO_H
            descansos_11h += 1
            conduccion_hoy = 0.0
            desde_ultima_pausa = 0.0
        elif desde_ultima_pausa >= _PAUSA_TRAS_HORAS - _EPS:
            horas_totales += _PAUSA_DURACION_H
            paradas_45min += 1
            desde_ultima_pausa = 0.0

    return {"horas_totales": horas_totales, "paradas_45min": paradas_45min, "descansos_11h": descansos_11h}


def haversine_km(lat1, lon1, lat2, lon2):
    """Distancia en línea recta (km) entre dos puntos. Espejo en Python de
    haversineKm() en dashboard/lib/data.js (mismo cálculo, mismo redondeo natural)."""
    r = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


async def distancia_por_carretera(lat1, lon1, lat2, lon2):
    """Espejo en Python de distanciaPorCarretera() (dashboard/lib/osrm.js):
    distancia por CARRETERA REAL (km) entre dos puntos vía OSRM self-hosted.
    Devuelve None si OSRM no responde, no encuentra ruta, o falla la red --
    nunca lanza, el llamador decide el fallback."""
    url = f"{OSRM_URL}/route/v1/driving/{lon1},{lat1};{lon2},{lat2}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"overview": "false"})
        if resp.status_code != 200:
            return None
        datos = resp.json()
        if datos.get("code") != "Ok" or not datos.get("routes"):
            return None
        return datos["routes"][0]["distance"] / 1000
    except Exception:  # noqa: BLE001 -- OSRM caído/timeout: degradar a Haversine, no romper
        return None


async def km_entre_puntos(puntos):
    """Suma km entre una lista de {lat, lon} consecutivos, tramo a tramo:
    OSRM (carretera real) primero, Haversine × FACTOR_SINUOSIDAD_FALLBACK si
    OSRM no responde para ese tramo concreto. Mismo criterio que
    kmCarreteraViaje() en dashboard/lib/data.js.

    @return (km, estimado) -- estimado=True si ALGÚN tramo cayó al fallback,
    para poder avisar al usuario de que ese número no es 100% ruta real."""
    km = 0.0
    estimado = False
    for i in range(len(puntos) - 1):
        a, b = puntos[i], puntos[i + 1]
        tramo = await distancia_por_carretera(a["lat"], a["lon"], b["lat"], b["lon"])
        if tramo is None:
            tramo = haversine_km(a["lat"], a["lon"], b["lat"], b["lon"]) * FACTOR_SINUOSIDAD_FALLBACK
            estimado = True
        km += tramo
    return km, estimado


def punto_en_checkpoint(lat, lon, hito, umbral_default=None):
    """CHK.4: True si (lat, lon) está dentro del radio de un `hito` marcado
    checkpoint. Usa `hito["radio_m"]` si está configurado, si no cae a
    UMBRAL_GEO_LLEGADA_M (mismo criterio que la geo-llegada normal)."""
    if umbral_default is None:
        umbral_default = UMBRAL_GEO_LLEGADA_M
    radio = hito.get("radio_m") or umbral_default
    distancia_m = haversine_km(lat, lon, hito["lat"], hito["lon"]) * 1000
    return distancia_m <= radio


# ==========================================================================
# 18.D.7 — Cotización rápida por texto en el bot (/cotizar), para el gestor
# comercial: mismo cálculo que /presupuesto del dashboard, en modo blended
# (sin vehículo concreto, ver calcularCosteRuta en dashboard/lib/data.js --
# sin vehiculo.consumo_l_100km, ese cálculo YA cae a blended también). Alcance
# de 18.D.7 acordado con el usuario 2026-07-25: texto por Telegram, no audio
# todavía (Whisper self-host solo está decidido de nombre, no implementado).
# ==========================================================================

MARGEN_OBJETIVO_PCT_DEFAULT = 15  # mismo valor que MARGEN_OBJETIVO_PCT_DEFAULT en dashboard/lib/data.js
NOMINATIM_VIEWBOX_ESPANA = "-9.8,44.0,4.6,35.8"  # mismo sesgo que buscarDireccion() en dashboard/lib/data.js


async def geocodificar(texto):
    """Espejo simplificado de buscarDireccion() (dashboard/lib/data.js): mismo
    sesgo geográfico hacia España (viewbox sin `bounded`, no excluye el resto
    del mundo -- una ruta a Ámsterdam/Milán tiene que poder seguir
    encontrándose). Aquí solo hace falta EL PRIMER resultado -- flujo
    conversacional paso a paso, no una lista para elegir como en el wizard
    web. Devuelve None si no hay match o falla la red (se degrada pidiendo
    que el gestor sea más concreto, no rompe la conversación)."""
    q = (texto or "").strip()
    if len(q) < 3:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"format": "jsonv2", "limit": 1, "addressdetails": 0, "viewbox": NOMINATIM_VIEWBOX_ESPANA, "q": q},
                headers={"Accept": "application/json", "User-Agent": "NorentyBot/1.0 (cotizador)"},
            )
        if resp.status_code != 200:
            return None
        datos = resp.json()
    except Exception:  # noqa: BLE001 -- sin conexión/Nominatim caído: degradar, no romper
        return None
    if not datos:
        return None
    d = datos[0]
    if not d.get("lat") or not d.get("lon"):
        return None
    return {"direccion": d.get("display_name") or q, "lat": float(d["lat"]), "lon": float(d["lon"])}


def parsear_numero_es(texto):
    """Extrae el PRIMER número de un texto libre tipo '15000 kg' o '30m3' --
    coma tratada como punto decimal. Usa el número que aparece al principio
    (con espacios/unidad opcionales delante), no cualquier dígito del texto:
    "30m3" es 30, no 303 (que saldría de coger todos los dígitos sueltos).
    NO intenta resolver separador de miles (ambigüedad real "15.000" europeo
    vs "15.5" decimal) -- para las cifras de este flujo (peso/volumen de un
    envío) no hace falta, se pide el número simple sin separadores."""
    m = re.match(r"\s*([\d]+(?:[.,]\d+)?)", (texto or "").strip())
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", "."))
    except ValueError:
        return None


def calcular_presupuesto_bot(km, empresa):
    """Versión simplificada (modo blended, sin vehículo concreto) del
    cotizador de /presupuesto -- mismas fórmulas que calcularPresupuesto/
    calcularCosteRuta en dashboard/lib/data.js, reducidas al caso sin
    vehículo (que en el dashboard también cae a blended, ver
    resolveCosteKm)."""
    velocidad = empresa.get("velocidad_planificacion_kmh") or VELOCIDAD_PLANIFICACION_KMH_DEFAULT
    horas_conduccion = km / velocidad
    eta = calcular_eta_con_paradas(horas_conduccion)

    coste_km = empresa.get("coste_km")
    coste_total = round(km * coste_km, 2) if coste_km is not None else None

    margen = empresa.get("margen_objetivo_pct")
    if margen is None:
        margen = MARGEN_OBJETIVO_PCT_DEFAULT
    precio_sugerido = round(coste_total / (1 - margen / 100), 2) if coste_total is not None else None

    return {
        "km": round(km),
        "horas_conduccion": round(horas_conduccion, 1),
        "horas_totales": round(eta["horas_totales"], 1),
        "paradas_45min": eta["paradas_45min"],
        "descansos_11h": eta["descansos_11h"],
        "coste_total": coste_total,
        "margen_objetivo_pct": margen,
        "precio_sugerido": precio_sugerido,
    }


async def cmd_cotizar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)
    gestor = get_gestor_by_chat(chat_id)
    if not gestor:
        await update.message.reply_text(
            "Esta función es para gestores vinculados. Vincula tu cuenta desde "
            "Ajustes → Alertas por Telegram en el dashboard."
        )
        return
    ctx.chat_data["cotizacion"] = {"paso": "origen", "gestor_id": gestor["id"], "empresa_id": gestor["empresa_id"]}
    await update.message.reply_text(
        "📋 Cotización rápida — te pido unos datos, uno a uno (escribe /cancelar para salir).\n\n"
        "1/4 · ¿Cuál es el ORIGEN? (ciudad o dirección)"
    )


async def cmd_cancelar_cotizacion(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if ctx.chat_data.pop("cotizacion", None) is not None:
        await update.message.reply_text("Cotización cancelada.")


async def _mostrar_resumen_cotizacion(update: Update, ctx: ContextTypes.DEFAULT_TYPE, estado):
    empresa_r = ejecutar_con_reintentos(
        lambda: supabase.table("empresa").select("velocidad_planificacion_kmh, coste_km, margen_objetivo_pct")
        .eq("id", estado["empresa_id"]).execute(),
        contexto={"accion": "cotizar_empresa", "empresa_id": estado["empresa_id"]},
    )
    empresa = empresa_r.data[0] if empresa_r.data else {}

    km, estimado = await km_entre_puntos([estado["origen"], estado["destino"]])
    resultado = calcular_presupuesto_bot(km, empresa)
    estado["resultado"] = resultado
    estado["paso"] = "confirmar"

    lineas = [
        "📋 *Cotización* (distancia por carretera real)" if not estimado
        else "📋 *Cotización* (OSRM no disponible — distancia estimada en línea recta ×1.3)",
        "",
        f"Origen: {estado['origen']['direccion']}",
        f"Destino: {estado['destino']['direccion']}",
        f"Distancia: ~{resultado['km']} km",
    ]
    if estado.get("peso_kg") is not None:
        lineas.append(f"Peso: {estado['peso_kg']:.0f} kg")
    if estado.get("volumen_m3") is not None:
        lineas.append(f"Volumen: {estado['volumen_m3']:.1f} m³")
    lineas.append(f"Tiempo estimado: ~{resultado['horas_totales']} h (con descansos legales incluidos)")
    if resultado["coste_total"] is not None:
        lineas.append(f"Coste estimado: {resultado['coste_total']:.2f} €")
        lineas.append(f"Margen objetivo: {resultado['margen_objetivo_pct']}%")
        lineas.append(f"*Precio sugerido: {resultado['precio_sugerido']:.2f} €*")
    else:
        lineas.append("⚠️ No hay coste/km configurado en Ajustes — no se puede sugerir un precio.")
    lineas.append("")
    consideraciones = "sin vehículo concreto asignado (coste general de empresa, no el de un camión específico), sin desglose de peajes/dietas por separado."
    lineas.append(
        f"Consideraciones: {'distancia estimada (OSRM no disponible), ' if estimado else ''}{consideraciones}"
    )
    lineas.append("")
    lineas.append("¿Confirmas esta cotización?")

    teclado = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Confirmar", callback_data="cotizar_confirmar"),
        InlineKeyboardButton("❌ Cancelar", callback_data="cotizar_cancelar"),
    ]])
    await update.message.reply_text("\n".join(lineas), parse_mode="Markdown", reply_markup=teclado)


async def _procesar_paso_cotizacion(update: Update, ctx: ContextTypes.DEFAULT_TYPE, estado):
    texto = (update.message.text or "").strip()
    paso = estado["paso"]

    if paso == "confirmar":
        await update.message.reply_text("Usa los botones de arriba (✅/❌) para confirmar o cancelar esta cotización.")
        return

    if paso == "origen":
        resultado = await geocodificar(texto)
        if not resultado:
            await update.message.reply_text(
                "No he encontrado esa dirección. Prueba a ser más concreto (ej. 'Madrid' o 'Calle Mayor 3, Madrid')."
            )
            return
        estado["origen"] = resultado
        estado["paso"] = "destino"
        await update.message.reply_text(f"Origen: {resultado['direccion']}\n\n2/4 · ¿Cuál es el DESTINO?")
        return

    if paso == "destino":
        resultado = await geocodificar(texto)
        if not resultado:
            await update.message.reply_text("No he encontrado esa dirección. Prueba a ser más concreto.")
            return
        estado["destino"] = resultado
        estado["paso"] = "peso"
        await update.message.reply_text(
            f"Destino: {resultado['direccion']}\n\n3/4 · ¿PESO de la carga en kg? (escribe 'no' si no aplica)"
        )
        return

    if paso == "peso":
        if texto.lower() in ("no", "n/a", "-", ""):
            estado["peso_kg"] = None
        else:
            valor = parsear_numero_es(texto)
            if valor is None:
                await update.message.reply_text("No entendí el peso. Escribe solo el número en kg (ej. 15000) o 'no'.")
                return
            estado["peso_kg"] = valor
        estado["paso"] = "volumen"
        await update.message.reply_text("4/4 · ¿VOLUMEN de la carga en m³? (escribe 'no' si no aplica)")
        return

    if paso == "volumen":
        if texto.lower() in ("no", "n/a", "-", ""):
            estado["volumen_m3"] = None
        else:
            valor = parsear_numero_es(texto)
            if valor is None:
                await update.message.reply_text("No entendí el volumen. Escribe solo el número en m³ (ej. 30) o 'no'.")
                return
            estado["volumen_m3"] = valor
        await _mostrar_resumen_cotizacion(update, ctx, estado)
        return


async def cb_cotizar_confirmar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    estado = ctx.chat_data.pop("cotizacion", None)
    if not estado or not estado.get("resultado"):
        await query.edit_message_text("Esta cotización ya no está activa.")
        return
    r = estado["resultado"]
    resumen = f"✅ Cotización confirmada: {estado['origen']['direccion']} → {estado['destino']['direccion']}"
    if r["precio_sugerido"] is not None:
        resumen += f" — {r['precio_sugerido']:.2f} €"
    await query.edit_message_text(resumen)


async def cb_cotizar_cancelar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    ctx.chat_data.pop("cotizacion", None)
    await query.edit_message_text("Cotización cancelada.")


def debe_avisar_pausa(horas_conduccion, ya_avisado):
    """F13.5: True si toca avisar de la pausa legal (Reglamento 561, pausa
    tras 4,5h de conducción) y todavía no se ha avisado en este viaje. Pura,
    testeable. `ya_avisado` es el dedup por viaje (se guarda en chat_data,
    igual que `geo_preguntado`) -- se avisa UNA vez, nunca en bucle."""
    if ya_avisado:
        return False
    return horas_conduccion >= _PAUSA_TRAS_HORAS


# ROADMAP 20.7 (Marruecos/amigos de STOP): un hueco de cobertura entre dos
# pings consecutivos de `ubicacion` hace que Haversine punto-a-punto
# SUBESTIME el recorrido real (línea recta vs. carretera real). Umbral en
# segundos: por encima de esto, el tramo no se trata como "dos pings
# seguidos", se calcula por carretera (OSRM) igual que un tramo cualquiera.
UMBRAL_HUECO_COBERTURA_S = 45 * 60


async def km_desde_pings(chofer_id, desde_iso):
    """Suma la distancia entre los pings consecutivos de `ubicacion` de un
    chófer desde `desde_iso` -- extraído de horas_conduccion_estimadas_viaje
    (F13.5) para reutilizarlo también en resumen_ruta_completada (F14.5), sin
    duplicar la query/el bucle. Tramo a tramo: Haversine si los dos pings
    están dentro de lo esperado (UMBRAL_HUECO_COBERTURA_S), OSRM (carretera
    real) si hay un hueco de cobertura entre medias -- ver 20.7."""
    r = ejecutar_con_reintentos(
        lambda: supabase.table("ubicacion").select("lat, lon, created_at")
        .eq("chofer_id", chofer_id).order("created_at").execute(),
        contexto={"accion": "km_desde_pings", "chofer_id": chofer_id},
    )
    puntos = [p for p in (r.data or []) if p.get("created_at", "") >= desde_iso]
    km = 0.0
    for i in range(1, len(puntos)):
        a, b = puntos[i - 1], puntos[i]
        hueco = False
        try:
            dt = datetime.fromisoformat(b["created_at"].replace("Z", "+00:00")) - datetime.fromisoformat(a["created_at"].replace("Z", "+00:00"))
            hueco = dt.total_seconds() > UMBRAL_HUECO_COBERTURA_S
        except Exception:  # noqa: BLE001 -- created_at raro: tratar como sin hueco, Haversine de siempre
            hueco = False
        if hueco:
            tramo = await distancia_por_carretera(a["lat"], a["lon"], b["lat"], b["lon"])
            if tramo is None:
                tramo = haversine_km(a["lat"], a["lon"], b["lat"], b["lon"]) * FACTOR_SINUOSIDAD_FALLBACK
        else:
            tramo = haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])
        km += tramo
    return km


async def horas_conduccion_estimadas_viaje(chofer_id, desde_iso, velocidad_kmh):
    """F13.5: estima horas de conducción del viaje EN CURSO sumando la
    distancia entre los pings de `ubicacion` de este chófer desde que
    empezó el viaje (`desde_iso`) -- misma base honesta km/velocidad que
    `getEstado561` (JS), v1 conservadora, NO tacógrafo real (7B.4). Se apoya
    en los puntos ya guardados por UBI.1, sin llamada externa nueva."""
    km = await km_desde_pings(chofer_id, desde_iso)
    return km / velocidad_kmh if velocidad_kmh else 0.0


async def resumen_ruta_completada(chofer_id, desde_iso, velocidad_kmh, paradas):
    """F14.5: km/horas estimados de la ruta que el chófer acaba de terminar,
    para el mensaje de resumen (disparador = evento al completar el viaje,
    decisión del usuario 2026-07-15, NO cron). Reutiliza `km_desde_pings`
    (F13.5) -- misma base honesta que el resto de estimaciones por GPS, no
    tacógrafo real. `desde_iso=None` (viaje sin ningún evento registrado,
    caso raro) -> sin datos, se devuelve `km=None` en vez de fingir un 0."""
    if desde_iso is None:
        return {"km": None, "horas": None, "paradas": paradas}
    km = await km_desde_pings(chofer_id, desde_iso)
    horas = km / velocidad_kmh if velocidad_kmh else 0.0
    return {"km": round(km), "horas": round(horas, 1), "paradas": paradas}


def debe_guardar_ubicacion(ultimo_punto, lat, lon, ahora=None):
    """UBI.1: decide si un ping de live location merece guardarse en `ubicacion`,
    o si es ruido demasiado cercano al último punto guardado de ESE chófer.
    `ultimo_punto` = None (no hay ninguno todavía -> siempre se guarda) o
    {"lat", "lon", "created_at"} (ISO string o algo que datetime.fromisoformat
    entienda). Pura, testeable sin reloj real via `ahora`."""
    if ultimo_punto is None:
        return True

    ahora = ahora or datetime.now(timezone.utc)
    creado_en = ultimo_punto["created_at"]
    if isinstance(creado_en, str):
        creado_en = datetime.fromisoformat(creado_en.replace("Z", "+00:00"))
    segundos = (ahora - creado_en).total_seconds()
    if segundos >= UMBRAL_UBICACION_INTERVALO_S:
        return True

    distancia_m = haversine_km(lat, lon, ultimo_punto["lat"], ultimo_punto["lon"]) * 1000
    return distancia_m >= UMBRAL_UBICACION_DISTANCIA_M


TIPO_PARKING_KEY = {
    "parking": "parking_tipo_parking",
    "fueling": "parking_tipo_fueling",
    "rest_area": "parking_tipo_rest_area",
    "otro": "parking_tipo_otro",
}


def obtener_ubicacion_chofer(chofer):
    """Última ubicación conocida del chófer para /parking (ítem 6.7): primero
    la tabla `ubicacion` (GPS en vivo, si el chófer la comparte), y si no hay
    nada ahí, el último hito COMPLETADO de su viaje activo — proxy razonable
    de "dónde está ahora" sin depender de tracking en vivo. None si no hay
    ninguna señal de ubicación disponible.
    """
    ubic_r = (
        supabase.table("ubicacion")
        .select("lat, lon")
        .eq("chofer_id", chofer["id"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if ubic_r.data:
        return ubic_r.data[0]["lat"], ubic_r.data[0]["lon"]

    viaje_r = (
        supabase.table("viaje")
        .select("id")
        .eq("chofer_id", chofer["id"])
        .eq("estado", "en_curso")
        .execute()
    )
    if not viaje_r.data:
        return None

    hitos_r = (
        supabase.table("hito")
        .select("lat, lon, orden")
        .eq("viaje_id", viaje_r.data[0]["id"])
        .eq("estado", "completado")
        .order("orden", desc=True)
        .execute()
    )
    for h in hitos_r.data or []:
        if h.get("lat") is not None and h.get("lon") is not None:
            return h["lat"], h["lon"]
    return None


async def radio_conduccion_disponible_km(chofer):
    """ROADMAP 20.5: km que el chófer puede conducir antes de la próxima
    pausa obligatoria (Reglamento 561/2006, misma simplificación conservadora
    que calcular_eta_con_paradas), a partir de la conducción REAL de hoy
    estimada por GPS (horas_conduccion_estimadas_viaje, F13.5) -- no
    autoinformada. None si no hay viaje en curso o falta el dato de inicio
    (no se puede estimar, no se inventa un número)."""
    viaje_r = (
        supabase.table("viaje").select("id")
        .eq("chofer_id", chofer["id"]).eq("estado", "en_curso").execute()
    )
    if not viaje_r.data:
        return None
    inicio_r = (
        supabase.table("ejecucion_evento").select("ocurrido_en")
        .eq("viaje_id", viaje_r.data[0]["id"]).order("ocurrido_en").limit(1).execute()
    )
    inicio = inicio_r.data[0].get("ocurrido_en") if inicio_r.data else None
    if not inicio:
        return None
    emp_r = supabase.table("empresa").select("velocidad_planificacion_kmh").eq("id", chofer["empresa_id"]).execute()
    velocidad = (emp_r.data[0].get("velocidad_planificacion_kmh") if emp_r.data else None) or VELOCIDAD_PLANIFICACION_KMH_DEFAULT
    horas_conducidas = await horas_conduccion_estimadas_viaje(chofer["id"], inicio, velocidad)
    margen_h = max(0.0, _PAUSA_TRAS_HORAS - horas_conducidas)
    return velocidad * margen_h


async def cmd_parking(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """El chófer pide parking cercano a su última ubicación conocida (ítem 6.7).
    Junta el dataset abierto (visible para todos) + los parkings propios de su
    empresa — mismo criterio que getParkings() en el dashboard, pero replicado
    a mano aquí porque el bot usa la service role key (salta RLS).

    ROADMAP 20.4/20.5: el dataset abierto pasó de España (~763) a Europa
    (~19.700) -- traerlo entero aquí repetiría el corte silencioso de 1000
    filas de PostgREST (Fase 19) Y sería lento sin necesidad. Se acota por
    caja de coordenadas ANTES de pedirlo. Si hay viaje en curso, el radio de
    búsqueda es el km que el chófer puede conducir antes de la próxima pausa
    obligatoria -- un parking "cercano" que ya no se alcanza no sirve.
    """
    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await update.message.reply_text(t("es", "no_vinculado"))
        return

    punto = obtener_ubicacion_chofer(chofer)
    if not punto:
        await update.message.reply_text(t(chofer, "parking_sin_ubicacion"))
        return
    lat, lon = punto

    radio_km = await radio_conduccion_disponible_km(chofer)

    # Caja de coordenadas generosa (radio × 2, o 150km sin radio conocido) --
    # 1° de latitud ≈ 111 km; suficiente margen para no perder parkings por
    # redondeo, sin descargar el dataset europeo entero en cada consulta.
    margen_grados = ((radio_km or 150) * 2) / 111
    lat_min, lat_max = lat - margen_grados, lat + margen_grados
    lon_min, lon_max = lon - margen_grados, lon + margen_grados

    propios_r = (
        supabase.table("parking")
        .select("nombre, tipo, lat, lon, fuente, vigilado")
        .eq("empresa_id", chofer["empresa_id"])
        .execute()
    )
    abiertos_r = (
        supabase.table("parking")
        .select("nombre, tipo, lat, lon, fuente, vigilado")
        .eq("fuente", "dataset_abierto")
        .gte("lat", lat_min).lte("lat", lat_max)
        .gte("lon", lon_min).lte("lon", lon_max)
        .execute()
    )
    parkings = (propios_r.data or []) + (abiertos_r.data or [])

    con_distancia = [
        (p, haversine_km(lat, lon, p["lat"], p["lon"]))
        for p in parkings
        if p.get("lat") is not None and p.get("lon") is not None
    ]
    if radio_km is not None:
        con_distancia = [par for par in con_distancia if par[1] <= radio_km]
    con_distancia.sort(key=lambda par: par[1])
    top3 = con_distancia[:3]

    if not top3:
        clave = "parking_sin_resultados_radio" if radio_km is not None else "parking_sin_resultados"
        await update.message.reply_text(t(chofer, clave))
        return

    lineas = [t(chofer, "parking_titulo")]
    if radio_km is not None:
        lineas.append(t(chofer, "parking_radio_disponible", km=round(radio_km)))
    botones = []
    for p, dist in top3:
        if p.get("fuente") == "empresa" and p.get("nombre"):
            etiqueta = p["nombre"]
        else:
            etiqueta = t(chofer, TIPO_PARKING_KEY.get(p["tipo"], "parking_tipo_otro"))
        if p.get("vigilado") is True:
            etiqueta += " 🛡️"
        lineas.append(f"• {etiqueta} — {dist:.1f} km")
        gmaps = f"https://www.google.com/maps/dir/?api=1&destination={p['lat']},{p['lon']}"
        botones.append([
            InlineKeyboardButton(f"{etiqueta} ({dist:.1f} km) · {t(chofer, 'btn_como_llegar')}", url=gmaps)
        ])

    await update.message.reply_text(
        "\n".join(lineas),
        reply_markup=InlineKeyboardMarkup(botones),
    )


async def cmd_eta(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """ETA-561 del viaje activo del chófer (ítem 6.8). A diferencia de la
    viabilidad/ETA del dashboard (que usa TODOS los hitos = ruta planificada
    completa desde el origen), aquí se calcula el tiempo que queda desde AHORA:
    solo los hitos que aún NO están completados (pendiente/en_curso/fallido no
    cuenta como resuelto pero tampoco aporta km — se excluye igual que completado).
    Usa OSRM (carretera real) igual que el dashboard, con Haversine ×
    FACTOR_SINUOSIDAD_FALLBACK solo si OSRM no responde para algún tramo.
    """
    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await update.message.reply_text(t("es", "no_vinculado"))
        return

    viaje_r = (
        supabase.table("viaje")
        .select("id")
        .eq("chofer_id", chofer["id"])
        .eq("estado", "en_curso")
        .execute()
    )
    if not viaje_r.data:
        await update.message.reply_text(t(chofer, "sin_viaje_activo"))
        return

    hitos_r = (
        supabase.table("hito")
        .select("lat, lon, orden, estado")
        .eq("viaje_id", viaje_r.data[0]["id"])
        .order("orden")
        .execute()
    )
    restantes = [
        h for h in (hitos_r.data or [])
        if h.get("estado") not in ("completado", "fallido") and h.get("lat") is not None and h.get("lon") is not None
    ]

    if len(restantes) < 2:
        await update.message.reply_text(t(chofer, "eta_sin_hitos"))
        return

    empresa_r = (
        supabase.table("empresa")
        .select("velocidad_planificacion_kmh")
        .eq("id", chofer["empresa_id"])
        .execute()
    )
    velocidad = VELOCIDAD_PLANIFICACION_KMH_DEFAULT
    if empresa_r.data and empresa_r.data[0].get("velocidad_planificacion_kmh"):
        velocidad = empresa_r.data[0]["velocidad_planificacion_kmh"]

    km, _estimado = await km_entre_puntos(restantes)

    horas_conduccion = km / velocidad
    resultado = calcular_eta_con_paradas(horas_conduccion)

    lineas = [
        t(chofer, "eta_titulo"),
        t(chofer, "eta_conduccion", km=round(km), velocidad=velocidad, horas=round(horas_conduccion, 1)),
    ]

    if resultado["paradas_45min"] > 0 or resultado["descansos_11h"] > 0:
        partes = []
        if resultado["paradas_45min"] > 0:
            clave = "eta_parada" if resultado["paradas_45min"] == 1 else "eta_paradas"
            partes.append(f"{resultado['paradas_45min']} {t(chofer, clave)}")
        if resultado["descansos_11h"] > 0:
            clave = "eta_descanso" if resultado["descansos_11h"] == 1 else "eta_descansos"
            partes.append(f"{resultado['descansos_11h']} {t(chofer, clave)}")
        lineas.append("+ " + " + ".join(partes))
    else:
        lineas.append(t(chofer, "eta_sin_paradas"))

    lineas.append(t(chofer, "eta_total", horas=round(resultado["horas_totales"], 1)))

    await update.message.reply_text("\n".join(lineas))


async def procesar_notificaciones_asignacion(ctx: ContextTypes.DEFAULT_TYPE):
    """Job repetitivo (7A.3): avisa al chófer cuando el gestor le asigna un
    viaje. SIN botones de aceptar/rechazar — la decisión de a quién asignar es
    del gestor (que tiene el histórico e info de negocio, ver 7A.2), el chófer
    solo se entera de su ruta. Reemplaza el diseño original "Uber-style" de
    oferta con aceptar/rechazar, descartado a petición del usuario 2026-07-03.
    """
    from datetime import datetime, timezone

    # Filtro en servidor (auditoría de arquitectura 2026-07-05): antes traía
    # la tabla `viaje` ENTERA de TODAS las empresas en cada tick de 30s (el
    # bot usa service role, salta RLS) y filtraba en Python — el coste crecía
    # con el total histórico de viajes de toda la plataforma, no solo los
    # pendientes de notificar. Empujar el filtro a la query evita traer filas
    # que nunca iban a usarse.
    viajes_r = (
        supabase.table("viaje")
        .select("id, referencia, chofer_id, estado, notificado_asignacion_en")
        .not_.is_("chofer_id", "null")
        .in_("estado", ["planificado", "en_curso"])
        .is_("notificado_asignacion_en", "null")
        .execute()
    )
    pendientes = viajes_r.data or []

    for viaje in pendientes:
        ref = viaje.get("referencia") or viaje["id"][:8]
        ahora = datetime.now(timezone.utc).isoformat()

        chofer_r = supabase.table("chofer").select("id, nombre, idioma, chat_id, empresa_id").eq("id", viaje["chofer_id"]).execute()
        chofer = chofer_r.data[0] if chofer_r.data else None
        if not chofer:
            continue

        if not chofer.get("chat_id"):
            # Hallazgo 2026-07-15: antes se marcaba "avisado" AQUÍ mismo, sin
            # comprobar si el aviso al gestor (el único que queda como
            # fallback) llegó a alguien de verdad. Si tampoco había ningún
            # gestor notificable (inactivo, sin Telegram, o con la
            # preferencia desactivada), el viaje quedaba "notificado" para
            # siempre sin que NADIE se hubiera enterado. Ahora solo se marca
            # si el fallback llegó a al menos un gestor; si no, se deja sin
            # marcar para que el siguiente tick lo reintente (mismo criterio
            # que el reintento ya existente más abajo si send_message falla).
            notificados = await notificar_gestor_evento(
                chofer["empresa_id"], viaje["id"],
                f"⚠️ {chofer['nombre']} no está vinculado a Telegram — no se le pudo avisar del viaje {ref}.",
            )
            if notificados > 0:
                supabase.table("viaje").update({"notificado_asignacion_en": ahora}).eq("id", viaje["id"]).execute()
            continue

        hitos_r = supabase.table("hito").select("orden, lat, lon, direccion").eq("viaje_id", viaje["id"]).order("orden").execute()
        hitos = hitos_r.data or []
        con_coords = [h for h in hitos if h.get("lat") is not None and h.get("lon") is not None]
        km, _estimado = await km_entre_puntos(con_coords)
        direccion = (hitos[0].get("direccion") if hitos else None) or t(chofer, "hito_sin_dir")

        texto = (
            t(chofer, "asignacion_titulo", ref=ref)
            + "\n"
            + t(chofer, "asignacion_detalle", n=len(hitos), km=round(km), dir=direccion)
        )

        try:
            await ctx.bot.send_message(chat_id=chofer["chat_id"], text=texto)
        except Exception as e:
            logger.error(
                "Error notificando asignación a %s: %s", chofer["chat_id"], e,
                extra={"chofer_id": chofer["id"], "viaje_id": viaje["id"], "empresa_id": chofer["empresa_id"], "chat_id": chofer["chat_id"]},
            )
            continue

        supabase.table("viaje").update({"notificado_asignacion_en": ahora}).eq("id", viaje["id"]).execute()


async def procesar_mensajes_gestor(ctx: ContextTypes.DEFAULT_TYPE):
    """Job repetitivo (17.G.10, 2026-07-23): entrega al chófer los mensajes que
    el gestor escribió desde el dashboard (`mensaje_chofer`, dirección
    'gestor_a_chofer'). MISMO patrón que `procesar_notificaciones_asignacion`
    (7A.3): el dashboard solo INSERTA la fila, este tick de 30s hace la
    entrega real y marca `entregado_en` -- así el dashboard no necesita saber
    nada de Telegram, ni bloquear al gestor esperando una respuesta HTTP del
    bot."""
    from datetime import datetime, timezone

    pendientes_r = (
        supabase.table("mensaje_chofer")
        .select("id, chofer_id, viaje_id, texto, empresa_id")
        .eq("direccion", "gestor_a_chofer")
        .is_("entregado_en", "null")
        .execute()
    )
    pendientes = pendientes_r.data or []

    for msg in pendientes:
        chofer_r = supabase.table("chofer").select("id, nombre, idioma, chat_id").eq("id", msg["chofer_id"]).execute()
        chofer = chofer_r.data[0] if chofer_r.data else None
        if not chofer or not chofer.get("chat_id"):
            continue  # sin Telegram vinculado: se reintenta en el siguiente tick, no se pierde

        try:
            await ctx.bot.send_message(
                chat_id=chofer["chat_id"],
                text=f"💬 Mensaje de tu gestor:\n\n{msg['texto']}",
            )
        except Exception as e:
            logger.error(
                "Error entregando mensaje de gestor a %s: %s", chofer["chat_id"], e,
                extra={"chofer_id": chofer["id"], "mensaje_id": msg["id"], "empresa_id": msg["empresa_id"]},
            )
            continue

        ahora = datetime.now(timezone.utc).isoformat()
        supabase.table("mensaje_chofer").update({"entregado_en": ahora}).eq("id", msg["id"]).execute()

        if msg.get("viaje_id"):
            supabase.table("contexto").insert({
                "empresa_id": msg["empresa_id"], "entidad": "viaje", "entidad_id": msg["viaje_id"],
                "canal": "mensaje_gestor", "texto": msg["texto"],
            }).execute()


async def manejar_error(update, ctx):
    """Manejador de errores global de PTB (ítem 8.2) — la última red de
    seguridad: cualquier excepción no capturada en CUALQUIER handler pasa por
    aquí en vez de dejar al chófer sin respuesta y sin que nadie se entere.
    Registra en Sentry con contexto y, si puede identificar el chat, avisa al
    chófer en su idioma en vez de dejarlo en silencio.
    """
    logger.error(
        "Excepción no capturada procesando %s: %s", update, ctx.error, exc_info=ctx.error,
        extra={"update_id": getattr(update, "update_id", None)},
    )

    chat_id = None
    idioma = "es"
    if isinstance(update, Update) and update.effective_chat:
        chat_id = update.effective_chat.id
        try:
            chofer = get_chofer_by_chat(chat_id)
            if chofer:
                idioma = chofer.get("idioma", "es")
        except Exception:
            pass  # si ni esto funciona, seguimos con "es" por defecto

    if os.environ.get("SENTRY_DSN"):
        with sentry_sdk.push_scope() as scope:
            scope.set_tag("update_id", getattr(update, "update_id", None))
            if chat_id:
                scope.set_tag("chat_id", chat_id)
            sentry_sdk.capture_exception(ctx.error)

    if chat_id:
        try:
            await ctx.bot.send_message(chat_id=chat_id, text=t(idioma, "error_tecnico"))
        except Exception as e:
            logger.error(
                "No se pudo ni avisar al chófer del error técnico: %s", e,
                extra={"chat_id": chat_id, "update_id": getattr(update, "update_id", None)},
            )


HEARTBEAT_INTERVAL_S = 120  # cada 2 min — el dashboard (8.3) avisa si el último es más viejo que ~2.5x esto


async def heartbeat(ctx):
    """Job repetitivo (8.3): registra que el bot está vivo. Insert-only, sin
    reintentos (si falla una vez, la siguiente pasada 2 min después ya
    corrige la señal — no vale la pena la complejidad de reintentar esto)."""
    try:
        supabase.table("bot_heartbeat").insert({}).execute()
    except Exception as e:
        logger.error("No se pudo registrar el heartbeat: %s", e)


COLA_TICK_INTERVAL_S = 20   # cada 20 s se drena un lote de la cola


async def procesar_cola(ctx):
    """Job repetitivo (9.18, ver SPECS-9.md "Bloque colas"): drena un lote de
    cola_trabajo. El trabajo real es SÍNCRONO (psycopg2), así que se ejecuta
    en un executor para NO congelar el event loop del bot. Un fallo aquí no
    debe tumbar el job: se loguea y ya."""
    try:
        loop = asyncio.get_event_loop()
        resumen = await loop.run_in_executor(None, cola.tick)
        if resumen.get("reclamados"):
            logger.info("Cola: %s", resumen, extra=resumen)
    except Exception as e:      # noqa: BLE001
        logger.error("Fallo en el tick de la cola: %s", e)


def create_bot_app():
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_error_handler(manejar_error)
    # ítem 9.9: guardas de perímetro, cada una en su PROPIO grupo negativo —
    # corren ANTES que cualquier handler "de verdad" (group 0, por defecto).
    # PTB solo ejecuta 0-1 handler POR GRUPO (rompe tras el primero que
    # matchea), así que dos TypeHandler(Update) en el MISMO grupo dejarían el
    # segundo muerto: cada guarda necesita su propio grupo para que ambas
    # corran siempre. -2 (dedupe) antes que -1 (rate-limit): no tiene sentido
    # contar un reintento duplicado contra la cuota de flood del chófer.
    app.add_handler(TypeHandler(Update, descartar_update_duplicado), group=-2)
    app.add_handler(TypeHandler(Update, limitar_flujo), group=-1)
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("estado", cmd_estado))
    app.add_handler(CommandHandler("remolque", cmd_remolque))
    app.add_handler(CommandHandler("incidencia", cmd_incidencia))
    app.add_handler(CommandHandler("parking", cmd_parking))
    app.add_handler(CommandHandler("eta", cmd_eta))
    app.add_handler(CommandHandler("cotizar", cmd_cotizar))
    app.add_handler(CommandHandler("cancelar", cmd_cancelar_cotizacion))
    app.add_handler(CallbackQueryHandler(cb_pre_llegada, pattern=r"^pre_llegada:"))
    app.add_handler(CallbackQueryHandler(cb_llegada, pattern=r"^llegada:"))
    app.add_handler(CallbackQueryHandler(cb_sin_pod, pattern=r"^sin_pod:"))
    app.add_handler(CallbackQueryHandler(cb_incidencia, pattern=r"^inc:"))
    app.add_handler(CallbackQueryHandler(cb_anotacion_entrega, pattern=r"^anot:"))
    app.add_handler(CallbackQueryHandler(cb_cancelar, pattern=r"^cancelar$"))
    app.add_handler(CallbackQueryHandler(cb_cotizar_confirmar, pattern=r"^cotizar_confirmar$"))
    app.add_handler(CallbackQueryHandler(cb_cotizar_cancelar, pattern=r"^cotizar_cancelar$"))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.VOICE, handle_voice))
    app.add_handler(MessageHandler(filters.LOCATION, handle_location))
    app.add_handler(MessageHandler(filters.UpdateType.EDITED_MESSAGE & filters.LOCATION, handle_location))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_menu_texto))
    if app.job_queue:
        app.job_queue.run_repeating(procesar_notificaciones_asignacion, interval=30, first=15)
        app.job_queue.run_repeating(procesar_mensajes_gestor, interval=30, first=20)
        app.job_queue.run_repeating(heartbeat, interval=HEARTBEAT_INTERVAL_S, first=1)
        # ítem 9.18: el tick de la cola necesita DATABASE_URL (psycopg2, no
        # PostgREST — ver SPECS-9.md "Bloque colas" §9.2). Sin ella, registrar
        # el job solo produciría un KeyError repetido cada 20s; se omite y se
        # deja constancia en el log de arranque en vez de fallar en silencio
        # cada tick.
        if os.environ.get("DATABASE_URL"):
            app.job_queue.run_repeating(procesar_cola, interval=COLA_TICK_INTERVAL_S, first=25)
        else:
            logger.warning("Cola de trabajos (9.18) NO arrancada: falta DATABASE_URL en el entorno.")
    return app
