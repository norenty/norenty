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


def build_hito_message(hito, orden_actual, total_hitos):
    tipo = "RECOGIDA" if hito["tipo"] == "recogida" else "ENTREGA"
    direccion = hito.get("direccion", "sin dirección")

    texto = f"📍 Hito {orden_actual}/{total_hitos} — {tipo}\n"
    texto += f"📫 {direccion}\n"

    if hito.get("ventana_inicio") or hito.get("ventana_fin"):
        inicio = hito.get("ventana_inicio", "?")
        fin = hito.get("ventana_fin", "?")
        texto += f"🕐 Ventana: {inicio} – {fin}\n"

    if hito.get("notas"):
        texto += f"📝 {hito['notas']}\n"

    return texto


async def send_next_hito(chat_id, chofer_id, bot):
    viajes_r = (
        supabase.table("viaje")
        .select("id, referencia")
        .eq("chofer_id", chofer_id)
        .eq("estado", "en_curso")
        .execute()
    )

    if not viajes_r.data:
        await bot.send_message(chat_id=chat_id, text="No tienes ningún viaje activo.")
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

        chofer = get_chofer_by_chat(chat_id)
        if chofer:
            await notificar_gestor_evento(
                chofer["empresa_id"],
                viaje["id"],
                f"✅ Viaje {ref} completado — {total}/{total} hitos. Chófer: {chofer['nombre']}",
            )

        await bot.send_message(
            chat_id=chat_id,
            text=f"Viaje {ref} completado — {total}/{total} hitos.\n\nBuen trabajo.",
        )
        return

    texto = f"Viaje {ref} — {completados}/{total} hitos\n\n"
    texto += build_hito_message(pendiente, pendiente["orden"], total)
    texto += "\nPulsa cuando llegues al punto."

    buttons = nav_buttons(pendiente)
    buttons.append([
        InlineKeyboardButton("He llegado", callback_data=f"pre_llegada:{pendiente['id']}")
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
    await send_next_hito(chat_id, chofer["id"], ctx.bot)


async def cmd_estado(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)

    if not chofer:
        await update.message.reply_text("No estás vinculado. Usa /start TU_CODIGO primero.")
        return

    await send_next_hito(chat_id, chofer["id"], ctx.bot)


async def cb_pre_llegada(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    hito_id = query.data.split(":")[1]
    chat_id = str(query.message.chat_id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await query.edit_message_text("Error: no estás vinculado.")
        return

    hito, error = verificar_hito_pertenece_a_chofer(hito_id, chofer["id"])
    if error:
        await query.edit_message_text(error)
        return

    tipo = "recogida" if hito["tipo"] == "recogida" else "entrega"
    direccion = hito.get("direccion", "destino")

    await query.edit_message_text(
        text=f"¿Confirmas que has llegado a la {tipo} en {direccion}?",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("Sí, confirmo", callback_data=f"llegada:{hito_id}"),
                InlineKeyboardButton("No, cancelar", callback_data="cancelar"),
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
        await query.edit_message_text("Error: no estás vinculado.")
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

    if hito["tipo"] == "entrega":
        await query.edit_message_text(
            f"Llegada registrada en {hito.get('direccion', 'destino')}.\n\n"
            "Ahora necesito la FOTO DEL ALBARÁN.\n"
            "Mándame la foto por aquí."
        )
    else:
        supabase.table("hito").update({"estado": "completado"}).eq("id", hito_id).execute()
        supabase.table("ejecucion_evento").insert({
            "viaje_id": viaje["id"],
            "hito_id": hito_id,
            "chofer_id": chofer_id,
            "tipo": "salida",
        }).execute()

        await query.edit_message_text(
            f"Recogida completada en {hito.get('direccion', 'origen')}."
        )
        await send_next_hito(chat_id, chofer_id, ctx.bot)


async def cb_cancelar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    chat_id = str(query.message.chat_id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await query.edit_message_text("Error: no estás vinculado.")
        return

    await query.edit_message_text("Cancelado. Pulsa cuando llegues de verdad.")
    await send_next_hito(chat_id, chofer["id"], ctx.bot)


async def handle_photo(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)

    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await update.message.reply_text("No estás vinculado. Usa /start TU_CODIGO primero.")
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
        await update.message.reply_text("No tienes ningún viaje activo.")
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
        await update.message.reply_text(
            "No hay ninguna entrega esperando albarán.\n"
            "Usa /estado para ver tu siguiente hito."
        )
        return

    hito = hito_r.data[0]

    await update.message.reply_text("Recibida. Subiendo foto...")

    photo = update.message.photo[-1]
    file = await ctx.bot.get_file(photo.file_id)
    file_bytes = await file.download_as_bytearray()

    file_ext = "jpg"
    file_name = f"{viaje['id']}/{hito['id']}/{uuid.uuid4()}.{file_ext}"

    supabase.storage.from_("pods").upload(
        path=file_name,
        file=bytes(file_bytes),
        file_options={"content-type": "image/jpeg"},
    )

    foto_url = supabase.storage.from_("pods").get_public_url(file_name)

    supabase.table("pod").insert({
        "hito_id": hito["id"],
        "viaje_id": viaje["id"],
        "foto_url": foto_url,
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
    await update.message.reply_text(
        f"Albarán recibido para {hito.get('direccion', 'entrega')}.\n"
        f"Entrega completada."
    )

    await notificar_gestor_evento(
        chofer["empresa_id"],
        viaje["id"],
        f"📄 Albarán recibido — Viaje {ref}, hito {hito['orden']} ({hito.get('direccion', '?')}). Chófer: {chofer['nombre']}.",
    )

    await send_next_hito(chat_id, chofer_id, ctx.bot)


async def cmd_incidencia(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """El chófer puede reportar una incidencia: /incidencia texto libre"""
    chat_id = str(update.effective_chat.id)
    chofer = get_chofer_by_chat(chat_id)
    if not chofer:
        await update.message.reply_text("No estás vinculado. Usa /start TU_CODIGO primero.")
        return

    texto = " ".join(ctx.args) if ctx.args else ""
    if not texto:
        await update.message.reply_text("Escribe qué ha pasado: /incidencia avería en la rueda trasera")
        return

    viajes_r = (
        supabase.table("viaje")
        .select("id, referencia")
        .eq("chofer_id", chofer["id"])
        .eq("estado", "en_curso")
        .execute()
    )
    if not viajes_r.data:
        await update.message.reply_text("No tienes ningún viaje activo.")
        return

    viaje = viajes_r.data[0]
    ref = viaje.get("referencia") or viaje["id"][:8]

    await alertar_gestor(
        chofer["empresa_id"],
        viaje["id"],
        "otro",
        f"Reportado por chófer {chofer['nombre']}: {texto}",
    )

    await update.message.reply_text(f"Incidencia reportada para viaje {ref}. Tu gestor ha sido notificado.")
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
