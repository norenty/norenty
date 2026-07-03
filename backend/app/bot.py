"""Norenty Telegram Bot — operación de hitos, POD, y alertas al gestor."""

import math
import os
import logging
import uuid
from urllib.parse import quote_plus

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
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    filters,
    ContextTypes,
)
from .db import supabase

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("norenty.bot")

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]

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
    },
}
# Idiomas sin traduccion completa: usar ingles como fallback
for _lang in ("ar", "it", "pt", "de"):
    TEXTOS.setdefault(_lang, TEXTOS["en"])

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
    r = supabase.table("chofer").select("id, nombre, empresa_id").eq("chat_id", str(chat_id)).execute()
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
    r = (
        supabase.table("hito")
        .select("*, viaje!inner(id, chofer_id, estado, referencia)")
        .eq("id", hito_id)
        .execute()
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
                logger.error("Error notificando gestor %s: %s", chat, e)


async def notificar_gestor_evento(empresa_id, viaje_id, mensaje):
    """Envía notificación informativa (no incidencia) a los gestores."""
    gestores_r = supabase.table("gestor").select("telegram_chat_id").eq("empresa_id", empresa_id).execute()
    for g in (gestores_r.data or []):
        chat = g.get("telegram_chat_id")
        if chat:
            try:
                await transporte_gestor.enviar_texto(chat, mensaje)
            except Exception as e:
                logger.error("Error notificando gestor %s: %s", chat, e)


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
    logger.info("Gestor %s vinculado al chat %s", gestor_id, chat_id)


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
        f"Vinculado correctamente, {nombre}.\nIdioma: {idioma}",
        reply_markup=menu_keyboard(chofer),
    )

    logger.info("Chofer %s vinculado al chat %s", codigo, chat_id)
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

    supabase.table("hito").update({"estado": "en_curso"}).eq("id", hito_id).execute()
    supabase.table("ejecucion_evento").insert({
        "viaje_id": viaje["id"],
        "hito_id": hito_id,
        "chofer_id": chofer_id,
        "tipo": "llegada",
        "detalle": hito.get("direccion"),
    }).execute()

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

    logger.info("Llegada registrada: hito %s, chofer %s", hito_id, chofer_id)

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

    # Ruta: {empresa_id}/{viaje_id}/{hito_id}/{uuid}.jpg
    # empresa_id como primer segmento permite RLS de storage empresa-scoped.
    file_path = f"{chofer['empresa_id']}/{viaje['id']}/{hito['id']}/{uuid.uuid4()}.jpg"

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

    logger.info("POD subido: hito %s", hito["id"])

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
    logger.info("Incidencia manual: chofer %s, viaje %s", chofer["id"], viaje["id"])


# Mismo factor que dashboard/lib/data.js (FACTOR_SINUOSIDAD_FALLBACK): el bot
# no depende de OSRM, así que /eta siempre usa Haversine corregido, no solo
# como fallback.
FACTOR_SINUOSIDAD_FALLBACK = 1.3
VELOCIDAD_PLANIFICACION_KMH_DEFAULT = 75

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

    viajes_r = supabase.table("viaje").select(
        "id, referencia, chofer_id, estado, notificado_asignacion_en"
    ).execute()
    pendientes = [
        v for v in (viajes_r.data or [])
        if v.get("chofer_id") and v.get("estado") in ("planificado", "en_curso")
        and not v.get("notificado_asignacion_en")
    ]

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
            logger.error("Error notificando asignación a %s: %s", chofer["chat_id"], e)
            continue

        supabase.table("viaje").update({"notificado_asignacion_en": ahora}).eq("id", viaje["id"]).execute()


def create_bot_app():
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("estado", cmd_estado))
    app.add_handler(CommandHandler("incidencia", cmd_incidencia))
    app.add_handler(CommandHandler("parking", cmd_parking))
    app.add_handler(CommandHandler("eta", cmd_eta))
    app.add_handler(CallbackQueryHandler(cb_pre_llegada, pattern=r"^pre_llegada:"))
    app.add_handler(CallbackQueryHandler(cb_llegada, pattern=r"^llegada:"))
    app.add_handler(CallbackQueryHandler(cb_cancelar, pattern=r"^cancelar$"))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_menu_texto))
    if app.job_queue:
        app.job_queue.run_repeating(procesar_notificaciones_asignacion, interval=30, first=15)
    return app
