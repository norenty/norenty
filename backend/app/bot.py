"""Norenty Telegram Bot — 2A.1: conexión + vincular chófer."""

import os
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
)
from .db import supabase

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("norenty.bot")

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]


async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Vincula el chat_id de Telegram con un chófer en la BD."""
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

    idioma = chofer.get("idioma", "es")
    nombre = chofer.get("nombre", "chófer")

    await update.message.reply_text(
        f"Vinculado correctamente, {nombre}.\n"
        f"Idioma: {idioma.upper()}\n\n"
        "Recibirás tus viajes por aquí. Cuando tengas uno activo, "
        "te iré guiando paso a paso."
    )
    logger.info("Chofer %s vinculado al chat %s", codigo, chat_id)


async def cmd_estado(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Muestra el viaje activo del chófer (si tiene)."""
    chat_id = str(update.effective_chat.id)

    chofer_r = supabase.table("chofer").select("id, nombre").eq("chat_id", chat_id).execute()
    if not chofer_r.data:
        await update.message.reply_text(
            "No estás vinculado. Usa /start TU_CODIGO primero."
        )
        return

    chofer = chofer_r.data[0]

    viajes_r = (
        supabase.table("viaje")
        .select("id, referencia, estado")
        .eq("chofer_id", chofer["id"])
        .eq("estado", "en_curso")
        .execute()
    )

    if not viajes_r.data:
        await update.message.reply_text("No tienes ningún viaje activo ahora mismo.")
        return

    viaje = viajes_r.data[0]
    ref = viaje.get("referencia") or viaje["id"][:8]

    hitos_r = (
        supabase.table("hito")
        .select("id, orden, tipo, direccion, estado")
        .eq("viaje_id", viaje["id"])
        .order("orden")
        .execute()
    )

    hitos = hitos_r.data or []
    completados = sum(1 for h in hitos if h["estado"] == "completado")
    pendiente = next((h for h in hitos if h["estado"] in ("pendiente", "en_curso")), None)

    texto = f"Viaje {ref} — {completados}/{len(hitos)} hitos\n\n"
    if pendiente:
        texto += (
            f"Siguiente: {pendiente['tipo'].upper()} · {pendiente.get('direccion', 'sin dirección')}\n"
            f"Pulsa el botón cuando llegues."
        )
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("He llegado", callback_data=f"llegada:{pendiente['id']}")]
        ])
        await update.message.reply_text(texto, reply_markup=keyboard)
    else:
        texto += "Todos los hitos completados."
        await update.message.reply_text(texto)


async def cb_llegada(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Registra la llegada del chófer a un hito."""
    query = update.callback_query
    await query.answer()

    data = query.data
    if not data.startswith("llegada:"):
        return

    hito_id = data.split(":")[1]
    chat_id = str(query.message.chat_id)

    chofer_r = supabase.table("chofer").select("id").eq("chat_id", chat_id).execute()
    if not chofer_r.data:
        await query.edit_message_text("Error: no estás vinculado.")
        return

    chofer_id = chofer_r.data[0]["id"]

    hito_r = supabase.table("hito").select("*, viaje_id").eq("id", hito_id).execute()
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
            f"Recogida completada en {hito.get('direccion', 'origen')}.\n\n"
            "Usa /estado para ver el siguiente hito."
        )


def create_bot_app():
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("estado", cmd_estado))
    app.add_handler(CallbackQueryHandler(cb_llegada, pattern=r"^llegada:"))
    return app
