"""Tests end-to-end del bot (ítem 6.11): construye `Update`s REALES de
python-telegram-bot y los pasa por `app.process_update()` — el mismo camino
que recorre un mensaje real de Telegram — en vez de llamar a los handlers
directamente como hacen los tests unitarios (`await bot.cmd_x(update, ctx)`
con un `SimpleNamespace` a mano). Eso caza regresiones de "wiring" que un
test unitario no puede ver: handlers mal registrados, patrones de
`callback_data` que no casan, filtros de `CommandHandler`/`MessageHandler`
que no matchean el update real.

Nunca toca la red de Telegram de verdad: `Bot.get_me()` se parchea (si no,
`app.initialize()` intentaría llamar a la API real), y los métodos de envío
del bot (`send_message`, `edit_message_text`, `answer_callback_query`,
`get_file`) se sustituyen por fakes que capturan lo que se habría enviado.
`FakeSupabase` (misma que en los tests unitarios) sustituye la BD.
"""
from datetime import datetime, timezone

import pytest
from telegram import (
    Bot,
    CallbackQuery,
    Chat,
    Message,
    MessageEntity,
    PhotoSize,
    Update,
    User,
)

from app import bot as bot_module
from tests.fakes import FakeSupabase

CHOFER_ID = "11111111-1111-1111-1111-111111111111"  # debe medir 36 (formato UUID) — cmd_start lo exige
CHAT_ID = 555000111
TG_USER_ID = 777000222

_next_update_id = [1000]
_next_message_id = [2000]


def _uid():
    _next_update_id[0] += 1
    return _next_update_id[0]


def _mid():
    _next_message_id[0] += 1
    return _next_message_id[0]


class FakeTelegramAPI:
    """Sustituye las llamadas de red del Bot; captura lo que se habría enviado.
    `Bot`/`ExtBot` de PTB están "congelados" (no se puede hacer `bot.send_message
    = ...` a nivel de INSTANCIA — lanza AttributeError), así que estos métodos
    se parchean a nivel de CLASE (`monkeypatch.setattr(type(app.bot), ...)`),
    con `self` como primer argumento igual que un método normal.
    """

    def __init__(self):
        self.sent = []
        self.edited = []
        self.answered = []

    async def send_message(self, chat_id, text=None, **kwargs):
        self.sent.append({"chat_id": chat_id, "text": text, **kwargs})
        return Message(message_id=_mid(), date=datetime.now(timezone.utc), chat=Chat(id=chat_id, type="private"), text=text)

    async def edit_message_text(self, text=None, chat_id=None, message_id=None, **kwargs):
        self.edited.append({"chat_id": chat_id, "message_id": message_id, "text": text, **kwargs})
        return True

    async def answer_callback_query(self, callback_query_id, **kwargs):
        self.answered.append(callback_query_id)
        return True

    async def get_file(self, file_id, **kwargs):
        class FakeFile:
            async def download_as_bytearray(self_inner, *a, **kw):
                return bytearray(b"fake-jpg-bytes")
        return FakeFile()


def make_app(monkeypatch, fake_db):
    """Construye la Application real de bot.py, con supabase y la red de
    Telegram sustituidas por fakes."""
    monkeypatch.setattr(bot_module, "supabase", fake_db)

    async def fake_get_me(self, *args, **kwargs):
        # Bot.get_me() real cachea el resultado en self._bot_user (de ahí lee
        # la propiedad .username que CommandHandler necesita) — replicarlo aquí,
        # si no Application.initialize() deja el bot "sin inicializar" de verdad.
        user = User(id=999999999, is_bot=True, first_name="NorentyTestBot", username="NorentyTestBot")
        self._bot_user = user
        return user

    monkeypatch.setattr(Bot, "get_me", fake_get_me)

    app = bot_module.create_bot_app()
    api = FakeTelegramAPI()
    bot_class = type(app.bot)
    monkeypatch.setattr(bot_class, "send_message", api.send_message)
    monkeypatch.setattr(bot_class, "edit_message_text", api.edit_message_text)
    monkeypatch.setattr(bot_class, "answer_callback_query", api.answer_callback_query)
    monkeypatch.setattr(bot_class, "get_file", api.get_file)
    return app, api


def command_update(app, text, chat_id=CHAT_ID, user_id=TG_USER_ID):
    """Construye un Update con un mensaje de comando (/comando args), con la
    MessageEntity BOT_COMMAND que CommandHandler exige para matchear."""
    comando_len = len(text.split()[0])  # incluye la barra, ej. "/start" -> 6
    chat = Chat(id=chat_id, type="private")
    user = User(id=user_id, is_bot=False, first_name="Test")
    message = Message(
        message_id=_mid(),
        date=datetime.now(timezone.utc),
        chat=chat,
        from_user=user,
        text=text,
        entities=[MessageEntity(type=MessageEntity.BOT_COMMAND, offset=0, length=comando_len)],
    )
    message.set_bot(app.bot)
    return Update(update_id=_uid(), message=message)


def text_update(app, text, chat_id=CHAT_ID, user_id=TG_USER_ID):
    """Update con un mensaje de texto plano (sin entidad de comando) — para el
    menú persistente (ReplyKeyboardMarkup)."""
    chat = Chat(id=chat_id, type="private")
    user = User(id=user_id, is_bot=False, first_name="Test")
    message = Message(
        message_id=_mid(), date=datetime.now(timezone.utc), chat=chat, from_user=user, text=text,
    )
    message.set_bot(app.bot)
    return Update(update_id=_uid(), message=message)


def photo_update(app, chat_id=CHAT_ID, user_id=TG_USER_ID):
    chat = Chat(id=chat_id, type="private")
    user = User(id=user_id, is_bot=False, first_name="Test")
    photo = PhotoSize(file_id="fake-file-id", file_unique_id="fake-unique-id", width=100, height=100)
    message = Message(
        message_id=_mid(), date=datetime.now(timezone.utc), chat=chat, from_user=user, photo=[photo],
    )
    message.set_bot(app.bot)
    return Update(update_id=_uid(), message=message)


def callback_update(app, data, ultimo_mensaje, chat_id=CHAT_ID, user_id=TG_USER_ID):
    """Update de pulsar un botón inline. `ultimo_mensaje` es el Message del
    bot al que va asociado el callback (necesario para edit_message_text)."""
    user = User(id=user_id, is_bot=False, first_name="Test")
    cq = CallbackQuery(id=f"cbq-{_uid()}", from_user=user, chat_instance="fake-chat-instance", data=data, message=ultimo_mensaje)
    cq.set_bot(app.bot)
    return Update(update_id=_uid(), callback_query=cq)


def ultimo_mensaje_bot(app, api, chat_id=CHAT_ID):
    """Construye un Message "del bot" a partir del último envío capturado, para
    que un callback_update posterior pueda referenciarlo (edit_message_text
    necesita chat_id + message_id del mensaje que se está editando, Y el
    propio Message necesita `.set_bot()` — si no, `query.edit_message_text()`
    revienta con "no bot associated with it")."""
    enviado = api.sent[-1]
    msg = Message(
        message_id=enviado.get("message_id", _mid()),
        date=datetime.now(timezone.utc),
        chat=Chat(id=chat_id, type="private"),
        text=enviado.get("text"),
    )
    msg.set_bot(app.bot)
    return msg


def mensaje_editado(app, api, chat_id=CHAT_ID):
    """Igual que ultimo_mensaje_bot(), pero a partir del último edit_message_text
    capturado (para encadenar dos ediciones seguidas sobre el mismo mensaje)."""
    editado = api.edited[-1]
    msg = Message(
        message_id=editado["message_id"], date=datetime.now(timezone.utc),
        chat=Chat(id=chat_id, type="private"), text=editado.get("text"),
    )
    msg.set_bot(app.bot)
    return msg


@pytest.mark.asyncio
async def test_e2e_flujo_completo_start_hito_llegada_pod_completar(monkeypatch):
    """/start CODIGO -> ve hito 1 (recogida) -> confirma llegada -> ve hito 2
    (entrega) -> confirma llegada -> envía foto (POD) -> viaje completado.
    Recorre TODO el enrutado real: CommandHandler, 2 CallbackQueryHandler
    distintos (pre_llegada/llegada), MessageHandler de fotos.
    """
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [
        {
            "id": "h1", "viaje_id": "v1", "orden": 1, "tipo": "recogida", "direccion": "Origen",
            "estado": "pendiente",
            "viaje": {"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"},
        },
        {
            "id": "h2", "viaje_id": "v1", "orden": 2, "tipo": "entrega", "direccion": "Destino",
            "estado": "pendiente",
            "viaje": {"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"},
        },
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        # 1) /start CODIGO -> vincula + envía hito 1 (recogida) con botón "pre_llegada:h1"
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        assert fake_db.tables["chofer"][0]["chat_id"] == str(CHAT_ID)
        assert any("Vinculado correctamente" in s["text"] for s in api.sent)
        assert any("RECOGIDA" in s.get("text", "") for s in api.sent)
        msg_hito1 = ultimo_mensaje_bot(app, api)

        # 2) Pulsa "He llegado" en el hito 1 -> cb_pre_llegada (pide confirmación)
        await app.process_update(callback_update(app, "pre_llegada:h1", msg_hito1))
        assert any("¿Confirmas" in e.get("text", "") for e in api.edited)
        msg_confirmacion = mensaje_editado(app, api)

        # 3) Confirma -> cb_llegada: hito recogida se completa solo, pasa al hito 2 (entrega)
        await app.process_update(callback_update(app, "llegada:h1", msg_confirmacion))
        assert fake_db.tables["hito"][0]["estado"] == "completado"
        assert any("Recogida completada" in e.get("text", "") for e in api.edited)
        assert any("ENTREGA" in s.get("text", "") for s in api.sent)  # send_next_hito -> hito 2
        msg_hito2 = ultimo_mensaje_bot(app, api)

        # 4) Pulsa "He llegado" en el hito 2 (entrega) -> confirmación
        await app.process_update(callback_update(app, "pre_llegada:h2", msg_hito2))
        msg_confirmacion2 = mensaje_editado(app, api)

        # 5) Confirma llegada al hito de ENTREGA -> pide foto del albarán (no completa aún)
        await app.process_update(callback_update(app, "llegada:h2", msg_confirmacion2))
        assert fake_db.tables["hito"][1]["estado"] == "en_curso"
        assert any("FOTO DEL ALBARÁN" in e.get("text", "") for e in api.edited)

        # 6) Envía la foto -> handle_photo: sube a storage, crea pod, completa
        #    hito, y como era el último hito, completa el viaje.
        await app.process_update(photo_update(app))

        assert len(fake_db.storage.uploads) == 1
        assert fake_db.storage.uploads[0]["bucket"] == "pods"
        assert fake_db.tables["pod"][0]["hito_id"] == "h2"
        assert fake_db.tables["hito"][1]["estado"] == "completado"
        assert fake_db.tables["viaje"][0]["estado"] == "completado"
        assert any("completado" in s.get("text", "").lower() for s in api.sent)
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_incidencia(monkeypatch):
    """/incidencia texto libre -> notifica al gestor. Camino real de
    CommandHandler con argumentos (ctx.args poblado por el propio framework,
    no a mano como en los tests unitarios)."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": str(CHAT_ID),
    }]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"}]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-gestor-1"}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, "/incidencia avería en la rueda trasera"))

        assert fake_db.tables["incidencia"][0]["viaje_id"] == "v1"
        assert "avería en la rueda trasera" in fake_db.tables["incidencia"][0]["descripcion"]
        assert any("Incidencia reportada" in s.get("text", "") for s in api.sent)
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_comando_desconocido_no_rompe_nada(monkeypatch):
    """Un update que no matchea NINGÚN handler no debe lanzar — Application.process_update
    ya garantiza esto, pero confirma que el wiring no tiene un catch-all roto."""
    fake_db = FakeSupabase()
    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, "/comando_que_no_existe"))
        assert api.sent == []
    finally:
        await app.shutdown()
