"""Norenty Telegram Bot — operación de hitos, POD, y alertas al gestor."""

import os
import logging
import uuid
from urllib.parse import quote_plus
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
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
    },
}
# Idiomas sin traduccion completa: usar ingles como fallback
for _lang in ("ar", "it", "pt", "de"):
    TEXTOS.setdefault(_lang, TEXTOS["en"])


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
                from telegram import Bot
                bot = Bot(token=TOKEN)
                viaje_r = supabase.table("viaje").select("referencia").eq("id", viaje_id).execute()
                ref = viaje_r.data[0]["referencia"] if viaje_r.data else viaje_id[:8]
                await bot.send_message(
                    chat_id=chat,
                    text=f"⚠️ ALERTA — {tipo.replace('_', ' ').upper()}\n\nViaje: {ref}\n{descripcion}",
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
                from telegram import Bot
                bot = Bot(token=TOKEN)
                await bot.send_message(chat_id=chat, text=mensaje)
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
        f"Vinculado correctamente, {nombre}.\nIdioma: {idioma}"
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


def create_bot_app():
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("estado", cmd_estado))
    app.add_handler(CommandHandler("incidencia", cmd_incidencia))
    app.add_handler(CallbackQueryHandler(cb_pre_llegada, pattern=r"^pre_llegada:"))
    app.add_handler(CallbackQueryHandler(cb_llegada, pattern=r"^llegada:"))
    app.add_handler(CallbackQueryHandler(cb_cancelar, pattern=r"^cancelar$"))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    return app
