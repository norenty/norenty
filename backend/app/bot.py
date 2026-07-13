"""Norenty Telegram Bot — operación de hitos, POD, y alertas al gestor."""

import asyncio
import hashlib
import json
import math
import os
import logging
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


def _foto_pod_valida(datos: bytes) -> bool:
    if len(datos) > POD_MAX_BYTES:
        return False
    return bytes(datos[:3]) == POD_JPEG_MAGIC


# --- i18n ---
TEXTOS = {
    "es": {
        "sin_viaje_activo": "No tienes ningún viaje activo.",
        "viaje_completado": "Viaje {ref} completado — {total}/{total} hitos.\n\nBuen trabajo.",
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
        "recogida_ok": "Recogida completada en {dir}.",
        "foto_subiendo": "Recibida. Subiendo foto...",
        "sin_entrega_esperando": "No hay ninguna entrega esperando albarán.\nUsa /estado para ver tu siguiente hito.",
        "pod_ok": "Albarán recibido para {dir}.\nEntrega completada.",
        "foto_invalida": "Esa foto no parece válida. Mándame una foto normal del albarán (no un fichero ni un vídeo).",
        "incidencia_ayuda": "Escribe qué ha pasado: /incidencia avería en la rueda trasera",
        "incidencia_ok": "Incidencia reportada para viaje {ref}. Tu gestor ha sido notificado.",
        "btn_incidencia": "📍 Reportar incidencia",
        "btn_mi_viaje": "📋 Mi viaje",
        "btn_contactar": "📞 Contactar gestor",
        "contactar_info": "Tu gestor es {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Tu gestor es {nombre}.\nTodavía no ha configurado un contacto directo.",
        "contactar_sin_gestor": "Tu gestor aún no ha configurado contacto. Prueba con /incidencia si es urgente.",
        "parking_titulo": "📍 Parkings cercanos:",
        "parking_sin_ubicacion": "No tengo tu ubicación todavía. Confirma la llegada a un hito o comparte tu ubicación por Telegram.",
        "parking_sin_resultados": "No encontré parkings cercanos.",
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
        "recogida_ok": "Pickup completed at {dir}.",
        "foto_subiendo": "Received. Uploading...",
        "sin_entrega_esperando": "No delivery is waiting for a proof of delivery.\nUse /estado to see your next stop.",
        "pod_ok": "Proof of delivery received for {dir}.\nDelivery completed.",
        "foto_invalida": "That photo doesn't look valid. Send me a normal photo of the proof of delivery (not a file or a video).",
        "incidencia_ayuda": "Describe what happened: /incidencia flat tyre on rear wheel",
        "incidencia_ok": "Incident reported for trip {ref}. Your manager has been notified.",
        "btn_incidencia": "📍 Report incident",
        "btn_mi_viaje": "📋 My trip",
        "btn_contactar": "📞 Contact manager",
        "contactar_info": "Your manager is {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Your manager is {nombre}.\nNo direct contact configured yet.",
        "contactar_sin_gestor": "Your manager hasn't configured contact info yet. Try /incidencia if it's urgent.",
        "parking_titulo": "📍 Nearby parkings:",
        "parking_sin_ubicacion": "I don't have your location yet. Confirm arrival at a stop or share your location on Telegram.",
        "parking_sin_resultados": "No nearby parkings found.",
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
        "recogida_ok": "Ridicare finalizată la {dir}.",
        "foto_subiendo": "Primit. Se încarcă...",
        "sin_entrega_esperando": "Nicio livrare nu așteaptă document.\nFolosește /estado pentru a vedea următoarea oprire.",
        "pod_ok": "Document primit pentru {dir}.\nLivrare finalizată.",
        "foto_invalida": "Fotografia nu pare validă. Trimite-mi o fotografie normală a documentului (nu un fișier sau un videoclip).",
        "incidencia_ayuda": "Descrie ce s-a întâmplat: /incidencia pană la roata din spate",
        "incidencia_ok": "Incident raportat pentru cursa {ref}. Managerul tău a fost notificat.",
        "btn_incidencia": "📍 Raportează un incident",
        "btn_mi_viaje": "📋 Cursa mea",
        "btn_contactar": "📞 Contactează managerul",
        "contactar_info": "Managerul tău este {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Managerul tău este {nombre}.\nNu a configurat încă un contact direct.",
        "contactar_sin_gestor": "Managerul tău nu a configurat încă datele de contact. Încearcă /incidencia dacă este urgent.",
        "parking_titulo": "📍 Parcări din apropiere:",
        "parking_sin_ubicacion": "Nu am încă locația ta. Confirmă sosirea la o oprire sau distribuie locația pe Telegram.",
        "parking_sin_resultados": "Nu am găsit parcări în apropiere.",
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
        "recogida_ok": "Enlèvement terminé à {dir}.",
        "foto_subiendo": "Reçu. Envoi en cours...",
        "sin_entrega_esperando": "Aucune livraison n'attend de bon.\nUtilisez /estado pour voir votre prochain arrêt.",
        "pod_ok": "Bon de livraison reçu pour {dir}.\nLivraison terminée.",
        "foto_invalida": "Cette photo ne semble pas valide. Envoyez-moi une photo normale du bon de livraison (pas un fichier ni une vidéo).",
        "incidencia_ayuda": "Décrivez ce qui s'est passé : /incidencia crevaison roue arrière",
        "incidencia_ok": "Incident signalé pour le trajet {ref}. Votre responsable a été notifié.",
        "btn_incidencia": "📍 Signaler un incident",
        "btn_mi_viaje": "📋 Mon trajet",
        "btn_contactar": "📞 Contacter le responsable",
        "contactar_info": "Votre responsable est {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Votre responsable est {nombre}.\nAucun contact direct configuré pour le moment.",
        "contactar_sin_gestor": "Votre responsable n'a pas encore configuré de contact. Essayez /incidencia si c'est urgent.",
        "parking_titulo": "📍 Parkings à proximité :",
        "parking_sin_ubicacion": "Je n'ai pas encore votre position. Confirmez l'arrivée à un arrêt ou partagez votre position sur Telegram.",
        "parking_sin_resultados": "Aucun parking trouvé à proximité.",
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
        "recogida_ok": "Ritiro completato a {dir}.",
        "foto_subiendo": "Ricevuta. Caricamento foto...",
        "sin_entrega_esperando": "Nessuna consegna in attesa di bolla.\nUsa /estado per vedere la tua prossima tappa.",
        "pod_ok": "Bolla di consegna ricevuta per {dir}.\nConsegna completata.",
        "foto_invalida": "Questa foto non sembra valida. Inviami una foto normale della bolla di consegna (non un file né un video).",
        "incidencia_ayuda": "Scrivi cosa è successo: /incidencia foratura ruota posteriore",
        "incidencia_ok": "Incidente segnalato per il viaggio {ref}. Il tuo responsabile è stato avvisato.",
        "btn_incidencia": "📍 Segnala un incidente",
        "btn_mi_viaje": "📋 Il mio viaggio",
        "btn_contactar": "📞 Contatta il responsabile",
        "contactar_info": "Il tuo responsabile è {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Il tuo responsabile è {nombre}.\nNon ha ancora configurato un contatto diretto.",
        "contactar_sin_gestor": "Il tuo responsabile non ha ancora configurato un contatto. Prova con /incidencia se è urgente.",
        "parking_titulo": "📍 Parcheggi vicini:",
        "parking_sin_ubicacion": "Non ho ancora la tua posizione. Conferma l'arrivo a una tappa o condividi la tua posizione su Telegram.",
        "parking_sin_resultados": "Non ho trovato parcheggi vicini.",
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
        "recogida_ok": "Recolha concluída em {dir}.",
        "foto_subiendo": "Recebida. A carregar foto...",
        "sin_entrega_esperando": "Não há nenhuma entrega à espera de guia.\nUsa /estado para veres a tua próxima paragem.",
        "pod_ok": "Guia de transporte recebida para {dir}.\nEntrega concluída.",
        "foto_invalida": "Essa foto não parece válida. Envia-me uma foto normal da guia de transporte (não um ficheiro nem um vídeo).",
        "incidencia_ayuda": "Escreve o que aconteceu: /incidencia furo no pneu traseiro",
        "incidencia_ok": "Incidência reportada para a viagem {ref}. O teu gestor foi notificado.",
        "btn_incidencia": "📍 Reportar incidência",
        "btn_mi_viaje": "📋 A minha viagem",
        "btn_contactar": "📞 Contactar gestor",
        "contactar_info": "O teu gestor é {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "O teu gestor é {nombre}.\nAinda não configurou um contacto direto.",
        "contactar_sin_gestor": "O teu gestor ainda não configurou um contacto. Experimenta /incidencia se for urgente.",
        "parking_titulo": "📍 Parques de estacionamento próximos:",
        "parking_sin_ubicacion": "Ainda não tenho a tua localização. Confirma a chegada a uma paragem ou partilha a tua localização no Telegram.",
        "parking_sin_resultados": "Não encontrei parques de estacionamento próximos.",
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
        "recogida_ok": "Abholung in {dir} abgeschlossen.",
        "foto_subiendo": "Erhalten. Foto wird hochgeladen...",
        "sin_entrega_esperando": "Es wartet keine Lieferung auf einen Lieferschein.\nNutze /estado, um deinen nächsten Stopp zu sehen.",
        "pod_ok": "Lieferschein für {dir} erhalten.\nLieferung abgeschlossen.",
        "foto_invalida": "Dieses Foto scheint ungültig zu sein. Schick mir ein normales Foto des Lieferscheins (keine Datei und kein Video).",
        "incidencia_ayuda": "Schreib, was passiert ist: /incidencia Reifenpanne hinten",
        "incidencia_ok": "Vorfall für Fahrt {ref} gemeldet. Dein Disponent wurde benachrichtigt.",
        "btn_incidencia": "📍 Vorfall melden",
        "btn_mi_viaje": "📋 Meine Fahrt",
        "btn_contactar": "📞 Disponent kontaktieren",
        "contactar_info": "Dein Disponent ist {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "Dein Disponent ist {nombre}.\nHat noch keinen direkten Kontakt hinterlegt.",
        "contactar_sin_gestor": "Dein Disponent hat noch keinen Kontakt hinterlegt. Nutze /incidencia, wenn es dringend ist.",
        "parking_titulo": "📍 Parkplätze in der Nähe:",
        "parking_sin_ubicacion": "Ich habe deinen Standort noch nicht. Bestätige die Ankunft an einem Stopp oder teile deinen Standort über Telegram.",
        "parking_sin_resultados": "Keine Parkplätze in der Nähe gefunden.",
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
        "recogida_ok": "تم الاستلام في {dir}.",
        "foto_subiendo": "تم الاستلام. جارٍ رفع الصورة...",
        "sin_entrega_esperando": "لا يوجد تسليم بانتظار سند.\nاستخدم /estado لمعرفة محطتك التالية.",
        "pod_ok": "تم استلام سند التسليم لـ {dir}.\nاكتمل التسليم.",
        "foto_invalida": "هذه الصورة لا تبدو صالحة. أرسل لي صورة عادية لسند التسليم (وليس ملفًا أو فيديو).",
        "incidencia_ayuda": "اكتب ما حدث: /incidencia عطل في الإطار الخلفي",
        "incidencia_ok": "تم الإبلاغ عن حادثة للرحلة {ref}. تم إخطار المسؤول عنك.",
        "btn_incidencia": "📍 الإبلاغ عن حادثة",
        "btn_mi_viaje": "📋 رحلتي",
        "btn_contactar": "📞 الاتصال بالمسؤول",
        "contactar_info": "المسؤول عنك هو {nombre}.\n📧 {contacto}",
        "contactar_sin_contacto": "المسؤول عنك هو {nombre}.\nلم يقم بعد بإعداد وسيلة تواصل مباشرة.",
        "contactar_sin_gestor": "لم يقم المسؤول عنك بعد بإعداد وسيلة تواصل. جرّب /incidencia إذا كان الأمر عاجلاً.",
        "parking_titulo": "📍 مواقف قريبة:",
        "parking_sin_ubicacion": "لا أملك موقعك بعد. أكّد وصولك إلى إحدى المحطات أو شارك موقعك عبر تيليجرام.",
        "parking_sin_resultados": "لم أجد مواقف قريبة.",
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


async def alertar_gestor(empresa_id, viaje_id, tipo, descripcion):
    """Crea una incidencia y notifica a los gestores de la empresa por Telegram."""
    supabase.table("incidencia").insert({
        "viaje_id": viaje_id,
        "tipo": tipo,
        "descripcion": descripcion,
        "estado": "abierta",
    }).execute()

    gestores_r = supabase.table("gestor").select("telegram_chat_id").eq("empresa_id", empresa_id).execute()
    for g in (gestores_r.data or []):
        chat = g.get("telegram_chat_id")
        if chat:
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


async def notificar_gestor_evento(empresa_id, viaje_id, mensaje):
    """Envía notificación informativa (no incidencia) a los gestores."""
    gestores_r = supabase.table("gestor").select("telegram_chat_id").eq("empresa_id", empresa_id).execute()
    for g in (gestores_r.data or []):
        chat = g.get("telegram_chat_id")
        if chat:
            try:
                await transporte_gestor.enviar_texto(chat, mensaje)
            except Exception as e:
                logger.error(
                    "Error notificando gestor %s: %s", chat, e,
                    extra={"empresa_id": empresa_id, "viaje_id": viaje_id, "chat_id": chat},
                )


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


async def send_next_hito(chat_id, chofer, bot):
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


def menu_keyboard(chofer):
    """Teclado persistente con accesos rápidos para el chófer."""
    return ReplyKeyboardMarkup(
        [[t(chofer, "btn_incidencia"), t(chofer, "btn_mi_viaje"), t(chofer, "btn_contactar")]],
        resize_keyboard=True,
    )


def contactar_gestor_texto(chofer):
    """Nombre + contacto (email) del primer gestor de la empresa del chófer.
    No hay campo de teléfono en la tabla gestor; se usa el email disponible."""
    r = supabase.table("gestor").select("nombre, email").eq("empresa_id", chofer["empresa_id"]).execute()
    if not r.data:
        return t(chofer, "contactar_sin_gestor")
    gestor = r.data[0]
    nombre = gestor.get("nombre") or "—"
    email = gestor.get("email")
    if email:
        return t(chofer, "contactar_info", nombre=nombre, contacto=email)
    return t(chofer, "contactar_sin_contacto", nombre=nombre)


async def handle_menu_texto(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Enruta la pulsación de uno de los botones del menú persistente."""
    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        return

    texto = update.message.text

    if texto in BOTONES_INCIDENCIA:
        await update.message.reply_text(t(chofer, "incidencia_ayuda"))
    elif texto in BOTONES_MI_VIAJE:
        await send_next_hito(chat_id, chofer, ctx.bot)
    elif texto in BOTONES_CONTACTAR:
        await update.message.reply_text(contactar_gestor_texto(chofer))


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
            "Para vincularte, necesitas el código que te dio tu gestor.\n"
            "Escribe: /start TU_CODIGO"
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
    await send_next_hito(chat_id, chofer, ctx.bot)


async def cmd_estado(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)

    if not chofer:
        await update.message.reply_text(t("es", "no_vinculado"))
        return

    await send_next_hito(chat_id, chofer, ctx.bot)


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
        await query.edit_message_text(t(chofer, "pedir_foto", dir=dir_hito))
    else:
        supabase.table("hito").update({"estado": "completado"}).eq("id", hito_id).execute()
        supabase.table("ejecucion_evento").insert({
            "viaje_id": viaje["id"],
            "hito_id": hito_id,
            "chofer_id": chofer_id,
            "tipo": "salida",
        }).execute()

        await query.edit_message_text(t(chofer, "recogida_ok", dir=dir_hito))
        await send_next_hito(chat_id, chofer, ctx.bot)


async def cb_cancelar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    chat_id = str(query.message.chat_id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await query.edit_message_text(t("es", "no_vinculado"))
        return

    await query.edit_message_text(t(chofer, "cancelado"))
    await send_next_hito(chat_id, chofer, ctx.bot)


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

    hitos_r = (
        supabase.table("hito")
        .select("id, orden, lat, lon, direccion, estado")
        .eq("viaje_id", viaje_r.data[0]["id"])
        .order("orden")
        .execute()
    )
    pendientes = [
        h for h in (hitos_r.data or [])
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


async def handle_photo(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await update.message.reply_text(t("es", "no_vinculado"))
        return

    chofer_id = chofer["id"]

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
    if not _foto_pod_valida(file_bytes):
        logger.warning(
            "Foto de POD rechazada (tamaño=%d) para hito %s", len(file_bytes), hito["id"],
            extra={"hito_id": hito["id"], "viaje_id": viaje["id"], "chofer_id": chofer_id, "tamano_bytes": len(file_bytes)},
        )
        await update.message.reply_text(t(chofer, "foto_invalida"))
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

    await send_next_hito(chat_id, chofer, ctx.bot)


async def cmd_incidencia(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """El chófer puede reportar una incidencia: /incidencia texto libre"""
    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await update.message.reply_text(t("es", "no_vinculado"))
        return

    texto = " ".join(ctx.args) if ctx.args else ""
    if not texto:
        await update.message.reply_text(t(chofer, "incidencia_ayuda"))
        return

    viajes_r = (
        supabase.table("viaje")
        .select("id, referencia")
        .eq("chofer_id", chofer["id"])
        .eq("estado", "en_curso")
        .execute()
    )
    if not viajes_r.data:
        await update.message.reply_text(t(chofer, "sin_viaje_activo"))
        return

    viaje = viajes_r.data[0]
    ref = viaje.get("referencia") or viaje["id"][:8]

    await alertar_gestor(
        chofer["empresa_id"],
        viaje["id"],
        "otro",
        f"Reportado por chófer {chofer['nombre']}: {texto}",
    )

    await update.message.reply_text(t(chofer, "incidencia_ok", ref=ref))
    logger.info(
        "Incidencia manual: chofer %s, viaje %s", chofer["id"], viaje["id"],
        extra={"chofer_id": chofer["id"], "viaje_id": viaje["id"], "empresa_id": chofer["empresa_id"]},
    )


# Mismo factor que dashboard/lib/data.js (FACTOR_SINUOSIDAD_FALLBACK): el bot
# no depende de OSRM, así que /eta siempre usa Haversine corregido, no solo
# como fallback.
FACTOR_SINUOSIDAD_FALLBACK = 1.3
VELOCIDAD_PLANIFICACION_KMH_DEFAULT = 75

# Distancia (metros) por debajo de la cual el bot pregunta proactivamente si el
# chófer ha llegado, al recibir su ubicación en vivo (ítem 7A.4). Valor inicial
# razonable, NO pactado con cliente real — ajustable.
UMBRAL_GEO_LLEGADA_M = 300

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


async def cmd_parking(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """El chófer pide parking cercano a su última ubicación conocida (ítem 6.7).
    Junta el dataset abierto (visible para todos) + los parkings propios de su
    empresa — mismo criterio que getParkings() en el dashboard, pero replicado
    a mano aquí porque el bot usa la service role key (salta RLS).
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

    propios_r = (
        supabase.table("parking")
        .select("nombre, tipo, lat, lon, fuente")
        .eq("empresa_id", chofer["empresa_id"])
        .execute()
    )
    abiertos_r = (
        supabase.table("parking")
        .select("nombre, tipo, lat, lon, fuente")
        .eq("fuente", "dataset_abierto")
        .execute()
    )
    parkings = (propios_r.data or []) + (abiertos_r.data or [])

    con_distancia = [
        (p, haversine_km(lat, lon, p["lat"], p["lon"]))
        for p in parkings
        if p.get("lat") is not None and p.get("lon") is not None
    ]
    con_distancia.sort(key=lambda par: par[1])
    top3 = con_distancia[:3]

    if not top3:
        await update.message.reply_text(t(chofer, "parking_sin_resultados"))
        return

    lineas = [t(chofer, "parking_titulo")]
    botones = []
    for p, dist in top3:
        if p.get("fuente") == "empresa" and p.get("nombre"):
            etiqueta = p["nombre"]
        else:
            etiqueta = t(chofer, TIPO_PARKING_KEY.get(p["tipo"], "parking_tipo_otro"))
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
    El bot no depende de OSRM, así que usa Haversine × FACTOR_SINUOSIDAD_FALLBACK
    directamente (no solo como fallback, como sí ocurre en el dashboard).
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

    km = 0.0
    for i in range(len(restantes) - 1):
        km += haversine_km(
            restantes[i]["lat"], restantes[i]["lon"], restantes[i + 1]["lat"], restantes[i + 1]["lon"]
        ) * FACTOR_SINUOSIDAD_FALLBACK

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
            supabase.table("viaje").update({"notificado_asignacion_en": ahora}).eq("id", viaje["id"]).execute()
            await notificar_gestor_evento(
                chofer["empresa_id"], viaje["id"],
                f"⚠️ {chofer['nombre']} no está vinculado a Telegram — no se le pudo avisar del viaje {ref}.",
            )
            continue

        hitos_r = supabase.table("hito").select("orden, lat, lon, direccion").eq("viaje_id", viaje["id"]).order("orden").execute()
        hitos = hitos_r.data or []
        con_coords = [h for h in hitos if h.get("lat") is not None and h.get("lon") is not None]
        km = 0.0
        for i in range(len(con_coords) - 1):
            km += haversine_km(
                con_coords[i]["lat"], con_coords[i]["lon"], con_coords[i + 1]["lat"], con_coords[i + 1]["lon"]
            ) * FACTOR_SINUOSIDAD_FALLBACK
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
    app.add_handler(CommandHandler("incidencia", cmd_incidencia))
    app.add_handler(CommandHandler("parking", cmd_parking))
    app.add_handler(CommandHandler("eta", cmd_eta))
    app.add_handler(CallbackQueryHandler(cb_pre_llegada, pattern=r"^pre_llegada:"))
    app.add_handler(CallbackQueryHandler(cb_llegada, pattern=r"^llegada:"))
    app.add_handler(CallbackQueryHandler(cb_cancelar, pattern=r"^cancelar$"))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.LOCATION, handle_location))
    app.add_handler(MessageHandler(filters.UpdateType.EDITED_MESSAGE & filters.LOCATION, handle_location))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_menu_texto))
    if app.job_queue:
        app.job_queue.run_repeating(procesar_notificaciones_asignacion, interval=30, first=15)
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
