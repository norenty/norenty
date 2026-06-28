"""Norenty Telegram Bot — 2A.1+: flujo con botones, confirmación y navegación."""

import os
import logging
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


def nav_buttons(hito):
    """Genera botones de navegación (Google Maps + Waze) para un hito."""
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
    """Construye el mensaje de un hito con toda la info relevante."""
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
    """Busca el siguiente hito pendiente y lo envía al chófer."""
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
            "tipo_evento": "viaje_completado",
        }).execute()
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
    chofer_r = supabase.table("chofer").select("id").eq("chat_id", chat_id).execute()

    if not chofer_r.data:
        await update.message.reply_text("No estás vinculado. Usa /start TU_CODIGO primero.")
        return

    await send_next_hito(chat_id, chofer_r.data[0]["id"], ctx.bot)


async def cb_pre_llegada(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Paso 1: pide confirmación antes de registrar la llegada."""
    query = update.callback_query
    await query.answer()

    hito_id = query.data.split(":")[1]

    hito_r = supabase.table("hito").select("direccion, tipo").eq("id", hito_id).execute()
    if not hito_r.data:
        await query.edit_message_text("Error: hito no encontrado.")
        return

    hito = hito_r.data[0]
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
    """Paso 2: registra la llegada confirmada."""
    query = update.callback_query
    await query.answer()

    hito_id = query.data.split(":")[1]
    chat_id = str(query.message.chat_id)

    chofer_r = supabase.table("chofer").select("id").eq("chat_id", chat_id).execute()
    if not chofer_r.data:
        await query.edit_message_text("Error: no estás vinculado.")
        return

    chofer_id = chofer_r.data[0]["id"]

    hito_r = supabase.table("hito").select("*").eq("id", hito_id).execute()
    if not hito_r.data:
        await query.edit_message_text("Error: hito no encontrado.")
        return

    hito = hito_r.data[0]

    supabase.table("hito").update({"estado": "en_curso"}).eq("id", hito_id).execute()
    supabase.table("ejecucion_evento").insert({
        "viaje_id": hito["viaje_id"],
        "hito_id": hito_id,
        "chofer_id": chofer_id,
        "tipo_evento": "llegada",
        "datos": {"direccion": hito.get("direccion")},
    }).execute()

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
            "viaje_id": hito["viaje_id"],
            "hito_id": hito_id,
            "chofer_id": chofer_id,
            "tipo_evento": "salida",
        }).execute()

        await query.edit_message_text(
            f"Recogida completada en {hito.get('direccion', 'origen')}."
        )
        await send_next_hito(chat_id, chofer_id, ctx.bot)


async def cb_cancelar(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Cancela la confirmación de llegada y vuelve a mostrar el hito."""
    query = update.callback_query
    await query.answer()
    chat_id = str(query.message.chat_id)

    chofer_r = supabase.table("chofer").select("id").eq("chat_id", chat_id).execute()
    if not chofer_r.data:
        await query.edit_message_text("Error: no estás vinculado.")
        return

    await query.edit_message_text("Cancelado. Pulsa cuando llegues de verdad.")
    await send_next_hito(chat_id, chofer_r.data[0]["id"], ctx.bot)


def create_bot_app():
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("estado", cmd_estado))
    app.add_handler(CallbackQueryHandler(cb_pre_llegada, pattern=r"^pre_llegada:"))
    app.add_handler(CallbackQueryHandler(cb_llegada, pattern=r"^llegada:"))
    app.add_handler(CallbackQueryHandler(cb_cancelar, pattern=r"^cancelar$"))
    return app
