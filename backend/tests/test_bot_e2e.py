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
import hashlib
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
    Voice,
)

from app import bot as bot_module
from tests.fakes import FakeSupabase

CHOFER_ID = "11111111-1111-1111-1111-111111111111"  # debe medir 36 (formato UUID) — cmd_start lo exige
CHAT_ID = 555000111
TG_USER_ID = 777000222

_next_update_id = [1000]
_next_message_id = [2000]


@pytest.fixture(autouse=True)
def _reset_guardas_perimetro():
    """Los guardas de perímetro (ítem 9.9, dedupe/rate-limit) guardan estado a
    nivel de MÓDULO en bot.py — resetearlo antes de cada test evita que uno
    contamine al siguiente por reutilizar el mismo chat_id/update_id."""
    bot_module._update_ids_vistos.clear()
    bot_module._update_ids_orden.clear()
    bot_module._historial_por_chat.clear()
    yield


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
                # Magic bytes JPEG reales (FF D8 FF) — ítem 9.9 valida la firma
                # antes de subir, así que un fake sin ella sería rechazado.
                return bytearray(b"\xff\xd8\xfffake-jpg-bytes")
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


def voice_update(app, chat_id=CHAT_ID, user_id=TG_USER_ID):
    """Update de una nota de voz (11.3, Nivel 1 de la escalera de captura)."""
    chat = Chat(id=chat_id, type="private")
    user = User(id=user_id, is_bot=False, first_name="Test")
    voice = Voice(file_id="fake-voice-id", file_unique_id="fake-voice-unique", duration=7)
    message = Message(
        message_id=_mid(), date=datetime.now(timezone.utc), chat=chat, from_user=user, voice=voice,
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
        # 1) /start CODIGO -> vincula + checklist de salida (0 hitos completados) ->
        #    tras responder, envía hito 1 (recogida) con botón "pre_llegada:h1"
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        assert fake_db.tables["chofer"][0]["chat_id"] == str(CHAT_ID)
        assert any("Vinculado correctamente" in s["text"] for s in api.sent)
        assert any("sean" in s.get("text", "") or "neumáticos" in s.get("text", "") for s in api.sent)
        msg_checklist = ultimo_mensaje_bot(app, api)
        await app.process_update(callback_update(app, "checklist:ok:v1", msg_checklist))
        assert fake_db.tables["ejecucion_evento"][0]["tipo"] == "checklist_salida"
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
        # ítem 9.8: el hash se calcula sobre los bytes reales subidos (evidencia).
        assert fake_db.tables["pod"][0]["hash_sha256"] == hashlib.sha256(b"\xff\xd8\xfffake-jpg-bytes").hexdigest()
        assert fake_db.tables["hito"][1]["estado"] == "completado"
        assert fake_db.tables["viaje"][0]["estado"] == "completado"
        assert any("completado" in s.get("text", "").lower() for s in api.sent)
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_mi_viaje_con_hito_en_curso_no_duplica_llegada(monkeypatch):
    """Revisión de arquitectura 2026-08-05 (hallazgo #9): chófer confirma
    llegada a una entrega (hito queda 'en_curso', esperando POD) y, ANTES de
    mandar la foto, pulsa "Mi viaje" otra vez (mensaje perdido, reinicio de
    Telegram...). Antes volvía a mostrar "He llegado"; pulsarlo habría creado
    una SEGUNDA fila 'llegada' en la cadena de evidencia para el mismo hito.
    Ahora debe reenviar la petición de foto, sin tocar la cadena."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": str(CHAT_ID),
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [{
        "id": "h1", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino",
        "estado": "en_curso",
        "viaje": {"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"},
    }]
    fake_db.tables["ejecucion_evento"] = [
        {"id": "ev0", "viaje_id": "v1", "hito_id": None, "chofer_id": CHOFER_ID, "tipo": "checklist_salida"},
        {"id": "ev1", "viaje_id": "v1", "hito_id": "h1", "chofer_id": CHOFER_ID, "tipo": "llegada"},
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(text_update(app, "📋 Mi viaje"))

        assert any("FOTO DEL ALBARÁN" in s.get("text", "") for s in api.sent)
        assert not any("¿Has llegado" in s.get("text", "") or "pulsa_llegada" in s.get("text", "") for s in api.sent)
        # ni una segunda 'llegada' de más, ni cambio de estado del hito
        eventos_llegada = [e for e in fake_db.tables["ejecucion_evento"] if e["tipo"] == "llegada"]
        assert len(eventos_llegada) == 1
        assert fake_db.tables["hito"][0]["estado"] == "en_curso"
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_anotacion_entrega_tras_pod(monkeypatch):
    """Fase 23, 23.A.2: tras subir el POD, el bot pregunta por el estado de la
    mercancía; pulsar 'Llega mojada' registra un ejecucion_evento con el
    motivo, en el momento -- no días después cuando ya no se puede probar
    nada (DISCOVERY.md insight 14)."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [
        {
            "id": "h2", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino",
            "estado": "en_curso",
            "viaje": {"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"},
        },
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))

        # Envía la foto del POD -> además del "pod_ok", debe llegar la
        # pregunta de anotación con el hito h2 en el callback_data.
        await app.process_update(photo_update(app))
        assert fake_db.tables["hito"][0]["estado"] == "completado"
        assert any("¿Todo bien con la mercancía" in s.get("text", "") for s in api.sent)
        msg_anotacion = ultimo_mensaje_bot(app, api)

        # Pulsa "Llega mojada" -> debe registrar el evento con el motivo.
        await app.process_update(callback_update(app, "anot:mercancia_mojada:h2", msg_anotacion))

        eventos_anotacion = [e for e in fake_db.tables["ejecucion_evento"] if e.get("tipo") == "anotacion_entrega"]
        assert len(eventos_anotacion) == 1
        assert eventos_anotacion[0]["hito_id"] == "h2"
        assert eventos_anotacion[0]["detalle"] == "mercancia_mojada"
        assert eventos_anotacion[0]["chofer_id"] == CHOFER_ID
        assert any("Anotado" in e.get("text", "") for e in api.edited)
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_checklist_enganche_foto_se_guarda_en_el_acoplamiento(monkeypatch):
    """Fase 23, 23.C.5: tras /remolque enganchar, el bot ofrece mandar una
    foto del checklist (ruedas, lona); si el chófer la manda dentro de la
    ventana, se guarda en `acoplamiento.foto_checklist_url` -- no se confunde
    con un POD normal aunque no haya ningún viaje en curso."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["vehiculo"] = [{"id": "rem1", "matricula": "1234ABC", "tipo": "remolque", "empresa_id": "e1"}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        await app.process_update(command_update(app, "/remolque enganchar 1234ABC"))

        assert len(fake_db.tables["acoplamiento"]) == 1
        assert any("mándame una foto del enganche" in s.get("text", "") for s in api.sent)

        await app.process_update(photo_update(app))

        acoplamiento = fake_db.tables["acoplamiento"][0]
        assert acoplamiento["foto_checklist_url"] is not None
        assert "checklist_enganche" in acoplamiento["foto_checklist_url"]
        assert len(fake_db.storage.uploads) == 1
        assert any("Foto del checklist guardada" in s.get("text", "") for s in api.sent)
        # No debió tratarse como un POD normal (no hay tabla `pod` tocada).
        assert not fake_db.tables.get("pod")
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_anotacion_entrega_todo_bien_no_genera_evento(monkeypatch):
    """'Todo bien' es la ausencia de un dato, no un dato -- no debe crear
    ningún ejecucion_evento (ruido = la próxima anotación real se ignora)."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [
        {
            "id": "h2", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino",
            "estado": "en_curso",
            "viaje": {"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"},
        },
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        await app.process_update(photo_update(app))
        msg_anotacion = ultimo_mensaje_bot(app, api)

        await app.process_update(callback_update(app, "anot:bien:h2", msg_anotacion))

        assert not [e for e in fake_db.tables.get("ejecucion_evento", []) if e.get("tipo") == "anotacion_entrega"]
        assert any("Anotado" in e.get("text", "") for e in api.edited)
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_sello_si_no_dispara_incidencia(monkeypatch):
    """F13.7 (reformulado, 2026-07-30): tras el POD, la PRIMERA pregunta es si el
    cliente selló/firmó (antes que las anotaciones de mercancía) -- decir que sí
    guarda `pod.sellado = True` y no crea ninguna incidencia."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [
        {
            "id": "h2", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino",
            "estado": "en_curso",
            "viaje": {"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"},
        },
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        await app.process_update(photo_update(app))

        enviado_sello = next(s for s in api.sent if "sellado o firmado" in s.get("text", ""))
        msg_sello = Message(
            message_id=enviado_sello.get("message_id", _mid()), date=datetime.now(timezone.utc),
            chat=Chat(id=CHAT_ID, type="private"), text=enviado_sello.get("text"),
        )
        msg_sello.set_bot(app.bot)

        await app.process_update(callback_update(app, "sello:si:h2", msg_sello))

        assert fake_db.tables["pod"][0]["sellado"] is True
        assert not [i for i in fake_db.tables.get("incidencia", []) if i.get("tipo") == "entrega_sin_sello"]
        assert any("Registrado" in e.get("text", "") for e in api.edited)
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_sello_no_dispara_incidencia_automatica(monkeypatch):
    """Decir que NO está sellado guarda `pod.sellado = False` Y crea una
    incidencia real (no solo una notificación pasiva) -- "si no te sellan no
    cobras", el gestor tiene que enterarse el mismo día, no a fin de mes."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [
        {
            "id": "h2", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino",
            "estado": "en_curso",
            "viaje": {"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"},
        },
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        await app.process_update(photo_update(app))

        enviado_sello = next(s for s in api.sent if "sellado o firmado" in s.get("text", ""))
        msg_sello = Message(
            message_id=enviado_sello.get("message_id", _mid()), date=datetime.now(timezone.utc),
            chat=Chat(id=CHAT_ID, type="private"), text=enviado_sello.get("text"),
        )
        msg_sello.set_bot(app.bot)

        await app.process_update(callback_update(app, "sello:no:h2", msg_sello))

        assert fake_db.tables["pod"][0]["sellado"] is False
        incidencias_sello = [i for i in fake_db.tables.get("incidencia", []) if i.get("tipo") == "entrega_sin_sello"]
        assert len(incidencias_sello) == 1
        assert incidencias_sello[0]["viaje_id"] == "v1"
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_pernocta_segura_no_dispara_incidencia(monkeypatch):
    """Flujo completo: botón del menú -> texto (dónde para) -> Sí/No -> se
    guarda en pernocta_chofer. "Todo bien" no debe crear ninguna incidencia."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [
        {"id": "h1", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino", "estado": "en_curso"},
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        await app.process_update(text_update(app, "🅿️ Dónde paro esta noche"))
        await app.process_update(text_update(app, "Área de servicio A-2, Guadalajara"))

        enviado_pregunta = next(s for s in api.sent if "sitio seguro" in s.get("text", ""))
        msg_pregunta = Message(
            message_id=enviado_pregunta.get("message_id", _mid()), date=datetime.now(timezone.utc),
            chat=Chat(id=CHAT_ID, type="private"), text=enviado_pregunta.get("text"),
        )
        msg_pregunta.set_bot(app.bot)

        await app.process_update(callback_update(app, "pernocta:si", msg_pregunta))

        assert len(fake_db.tables["pernocta_chofer"]) == 1
        p = fake_db.tables["pernocta_chofer"][0]
        assert p["todo_ok"] is True
        assert p["comentario"] == "Área de servicio A-2, Guadalajara"
        assert p["viaje_id"] == "v1"
        assert fake_db.tables.get("incidencia", []) == []
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_pernocta_insegura_dispara_incidencia(monkeypatch):
    """Decir que el sitio NO es seguro guarda `todo_ok=False` Y crea una
    incidencia real (mismo patrón que sello/checklist_salida)."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [
        {"id": "h1", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino", "estado": "en_curso"},
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        await app.process_update(text_update(app, "🅿️ Dónde paro esta noche"))
        await app.process_update(text_update(app, "Polígono sin vigilancia"))

        enviado_pregunta = next(s for s in api.sent if "sitio seguro" in s.get("text", ""))
        msg_pregunta = Message(
            message_id=enviado_pregunta.get("message_id", _mid()), date=datetime.now(timezone.utc),
            chat=Chat(id=CHAT_ID, type="private"), text=enviado_pregunta.get("text"),
        )
        msg_pregunta.set_bot(app.bot)

        await app.process_update(callback_update(app, "pernocta:no", msg_pregunta))

        p = fake_db.tables["pernocta_chofer"][0]
        assert p["todo_ok"] is False
        incidencias = [i for i in fake_db.tables.get("incidencia", []) if i.get("tipo") == "pernocta_insegura"]
        assert len(incidencias) == 1
        assert incidencias[0]["viaje_id"] == "v1"
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_checklist_salida_ok_no_dispara_incidencia(monkeypatch):
    """Checklist de salida (2026-07-30): con 0 hitos completados, /start pregunta
    ANTES de mostrar el hito 1. Responder 'Todo correcto' registra el evento y
    no crea incidencia."""
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
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        assert any("neumáticos" in s.get("text", "") for s in api.sent)
        assert not any("RECOGIDA" in s.get("text", "") for s in api.sent)
        msg_checklist = ultimo_mensaje_bot(app, api)

        await app.process_update(callback_update(app, "checklist:ok:v1", msg_checklist))

        eventos = [e for e in fake_db.tables["ejecucion_evento"] if e.get("tipo") == "checklist_salida"]
        assert len(eventos) == 1
        assert eventos[0]["detalle"] == "ok"
        assert not fake_db.tables.get("incidencia")
        # Tras responder, SÍ se muestra el hito 1 -- el checklist no bloquea la operativa.
        assert any("RECOGIDA" in s.get("text", "") for s in api.sent)
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_checklist_salida_mal_dispara_incidencia(monkeypatch):
    """Responder 'Hay algo mal' crea una incidencia real (checklist_salida_fallo)
    para que el gestor lo sepa antes de que el camión arranque."""
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
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        msg_checklist = ultimo_mensaje_bot(app, api)

        await app.process_update(callback_update(app, "checklist:mal:v1", msg_checklist))

        eventos = [e for e in fake_db.tables["ejecucion_evento"] if e.get("tipo") == "checklist_salida"]
        assert len(eventos) == 1
        assert eventos[0]["detalle"] == "mal"
        incidencias = [i for i in fake_db.tables.get("incidencia", []) if i.get("tipo") == "checklist_salida_fallo"]
        assert len(incidencias) == 1
        assert incidencias[0]["viaje_id"] == "v1"
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_checklist_salida_no_se_repite_tras_primer_hito(monkeypatch):
    """Una vez respondido el checklist, no se vuelve a preguntar aunque
    send_next_hito se llame de nuevo más tarde (ya hay un ejecucion_evento
    checklist_salida para ese viaje)."""
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
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        msg_checklist = ultimo_mensaje_bot(app, api)
        await app.process_update(callback_update(app, "checklist:ok:v1", msg_checklist))

        # Segunda llamada a /estado -> NO debe volver a preguntar el checklist.
        await app.process_update(command_update(app, "/estado"))
        assert not any("neumáticos" in s.get("text", "") for s in api.sent[-1:])
        assert any("RECOGIDA" in s.get("text", "") for s in api.sent)
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_entrega_sin_pod_cuando_empresa_no_lo_requiere(monkeypatch):
    """Mismo flujo que arriba hasta el hito de ENTREGA, pero con
    `empresa.requiere_pod = False`: la entrega se completa SOLA al confirmar
    la llegada, sin pedir foto ni esperar `handle_photo`. Caza la regresión
    de conectar `empresa.requiere_pod` (existía en el esquema desde el
    Milestone 3 pero nunca se usaba en ningún sitio)."""
    fake_db = FakeSupabase()
    fake_db.tables["empresa"] = [{"id": "e1", "requiere_pod": False}]
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [
        {
            "id": "h2", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino",
            "estado": "pendiente",
            "viaje": {"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"},
        },
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        msg_checklist = ultimo_mensaje_bot(app, api)
        await app.process_update(callback_update(app, "checklist:ok:v1", msg_checklist))
        assert any("ENTREGA" in s.get("text", "") for s in api.sent)
        msg_hito = ultimo_mensaje_bot(app, api)

        await app.process_update(callback_update(app, "pre_llegada:h2", msg_hito))
        msg_confirmacion = mensaje_editado(app, api)

        await app.process_update(callback_update(app, "llegada:h2", msg_confirmacion))

        # No se pidió foto -- se completó directamente.
        assert not any("FOTO DEL ALBARÁN" in e.get("text", "") for e in api.edited)
        assert any("Entrega completada" in e.get("text", "") for e in api.edited)
        assert fake_db.tables["hito"][0]["estado"] == "completado"
        assert fake_db.tables["viaje"][0]["estado"] == "completado"
        assert fake_db.tables.get("pod", []) == []  # sin POD, como se pidió
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_llegada_tarde_sin_incidencia_previa_alerta_reactivamente(monkeypatch):
    """R1 (2026-07-15): si el chófer confirma tarde SIN que
    monitor_retraso_silencioso.py haya pasado antes por ese hito, se
    mantiene el aviso reactivo de siempre (alertar_gestor crea la
    incidencia)."""
    fake_db = FakeSupabase()
    ventana_pasada = "2020-01-01T00:00:00+00:00"
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [
        {
            "id": "h1", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino",
            "estado": "pendiente", "ventana_fin": ventana_pasada,
            "viaje": {"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"},
        },
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]
    fake_db.tables["incidencia"] = []

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        msg_hito = ultimo_mensaje_bot(app, api)
        await app.process_update(callback_update(app, "pre_llegada:h1", msg_hito))
        msg_confirmacion = mensaje_editado(app, api)
        await app.process_update(callback_update(app, "llegada:h1", msg_confirmacion))

        assert len(fake_db.tables["incidencia"]) == 1
        assert fake_db.tables["incidencia"][0]["tipo"] == "fuera_de_ventana"
        assert fake_db.tables["incidencia"][0]["estado"] == "abierta"
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_llegada_tarde_con_incidencia_previa_la_cierra_sin_duplicar(monkeypatch):
    """R1 (2026-07-15): si monitor_retraso_silencioso.py YA detectó y avisó de
    este hito (incidencia fuera_de_ventana abierta con hito_id), al confirmar
    la llegada NO se crea una segunda incidencia -- se cierra la existente."""
    fake_db = FakeSupabase()
    ventana_pasada = "2020-01-01T00:00:00+00:00"
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None,
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [
        {
            "id": "h1", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino",
            "estado": "pendiente", "ventana_fin": ventana_pasada,
            "viaje": {"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"},
        },
    ]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]
    fake_db.tables["incidencia"] = [{
        "id": "inc-monitor", "viaje_id": "v1", "hito_id": "h1", "tipo": "fuera_de_ventana", "estado": "abierta",
    }]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))
        msg_hito = ultimo_mensaje_bot(app, api)
        await app.process_update(callback_update(app, "pre_llegada:h1", msg_hito))
        msg_confirmacion = mensaje_editado(app, api)
        await app.process_update(callback_update(app, "llegada:h1", msg_confirmacion))

        assert len(fake_db.tables["incidencia"]) == 1  # no se duplicó
        assert fake_db.tables["incidencia"][0]["id"] == "inc-monitor"
        assert fake_db.tables["incidencia"][0]["estado"] == "resuelta"
        assert fake_db.tables["incidencia"][0]["resuelta_en"] is not None
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
async def test_e2e_incidencia_foto_se_adjunta_a_la_incidencia_no_crea_pod(monkeypatch):
    """F14.6 (2026-07-17): tras /incidencia, la siguiente foto que mande el
    chófer se adjunta a ESA incidencia (foto_url/foto_hash_sha256), no se
    trata como un POD -- aunque haya un hito de entrega en_curso esperando
    albarán al mismo tiempo (caso real: incidencia durante la propia
    entrega)."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": str(CHAT_ID),
    }]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"}]
    fake_db.tables["hito"] = [{
        "id": "h1", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino",
        "estado": "en_curso",
    }]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-gestor-1"}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, "/incidencia carga mal estibada"))
        incidencia_id = fake_db.tables["incidencia"][0]["id"]
        assert any("adjuntar" in s.get("text", "").lower() or "foto" in s.get("text", "").lower() for s in api.sent)

        await app.process_update(photo_update(app))

        assert fake_db.tables["incidencia"][0]["foto_url"] is not None
        assert fake_db.tables["incidencia"][0]["foto_hash_sha256"] == hashlib.sha256(b"\xff\xd8\xfffake-jpg-bytes").hexdigest()
        # NO se creó ningún POD ni se completó el hito de entrega -- la foto
        # era de la incidencia, no del albarán.
        assert fake_db.tables.get("pod", []) == []
        assert fake_db.tables["hito"][0]["estado"] == "en_curso"
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_start_con_telegram_ya_vinculado_a_otro_chofer_da_mensaje_claro(monkeypatch):
    """Hallazgo real en un smoke test en vivo (2026-07-22): chofer.chat_id es
    UNIQUE en BD -- vincular un Telegram ya usado por OTRO chófer revienta el
    UPDATE con un IntegrityError que antes caía en el manejador de errores
    genérico ("problema técnico"). Ahora se detecta ANTES del UPDATE y se
    explica con qué chófer está vinculado de verdad."""
    OTRO_CHOFER_ID = "22222222-2222-2222-2222-222222222222"
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [
        {"id": OTRO_CHOFER_ID, "nombre": "Paco", "empresa_id": "e1", "idioma": "es", "chat_id": str(CHAT_ID)},
        {"id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": None},
    ]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(command_update(app, f"/start {CHOFER_ID}"))

        assert any("ya está vinculado a otro chófer (Paco)" in s.get("text", "") for s in api.sent)
        # No se tocó el chat_id de Mario: sigue sin vincular, el UPDATE nunca llegó a ejecutarse.
        assert next(c for c in fake_db.tables["chofer"] if c["id"] == CHOFER_ID)["chat_id"] is None
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_nota_voz_se_ancla_al_viaje_como_contexto(monkeypatch):
    """11.3 (Nivel 1 de la escalera de captura): una nota de voz del chófer se
    guarda en Storage con su hash de integridad y queda anclada al viaje en
    curso como `contexto` (canal 'nota_voz'). SIN transcribir todavía: `texto`
    guarda el marcador hasta que Whisper corra retroactivamente."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": str(CHAT_ID),
    }]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(voice_update(app))

        assert len(fake_db.storage.uploads) == 1
        assert fake_db.storage.uploads[0]["bucket"] == "pods"
        assert "/voz/v1/" in fake_db.storage.uploads[0]["path"]

        fila = fake_db.tables["contexto"][0]
        assert fila["entidad"] == "viaje"
        assert fila["entidad_id"] == "v1"
        assert fila["canal"] == "nota_voz"
        assert fila["texto"] == bot_module.MARCADOR_NOTA_VOZ_SIN_TRANSCRIBIR
        assert fila["autor_externo"] == "Mario"
        assert fila["audio_url"] is not None
        # El hash es de los bytes reales que llegaron de Telegram (misma tesis
        # de evidencia que POD 9.8 / incidencia F14.6).
        assert fila["audio_hash_sha256"] == hashlib.sha256(b"\xff\xd8\xfffake-jpg-bytes").hexdigest()
        assert any("guardada" in s.get("text", "").lower() for s in api.sent)
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_nota_voz_sin_viaje_en_curso_no_guarda_nada(monkeypatch):
    """Sin viaje en curso no hay dónde anclar la nota: se avisa y NO se sube
    nada a Storage (evita audios huérfanos sin entidad)."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": str(CHAT_ID),
    }]
    fake_db.tables["viaje"] = []

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(voice_update(app))

        assert fake_db.storage.uploads == []
        assert fake_db.tables.get("contexto", []) == []
        assert any("viaje en curso" in s.get("text", "").lower() for s in api.sent)
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_foto_sin_incidencia_pendiente_sigue_siendo_pod_normal(monkeypatch):
    """Regresión: sin haber reportado ninguna incidencia antes, una foto sigue
    yendo al flujo de POD de siempre (F14.6 no debe robar fotos que no le
    corresponden)."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": str(CHAT_ID),
    }]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": CHOFER_ID, "estado": "en_curso", "referencia": "VJ-1"}]
    fake_db.tables["hito"] = [{
        "id": "h1", "viaje_id": "v1", "orden": 1, "tipo": "entrega", "direccion": "Destino",
        "estado": "en_curso",
    }]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-gestor-1"}]

    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        await app.process_update(photo_update(app))
        assert fake_db.tables["pod"][0]["hito_id"] == "h1"
        assert fake_db.tables["hito"][0]["estado"] == "completado"
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


@pytest.mark.asyncio
async def test_e2e_dedupe_update_id_no_duplica_procesamiento(monkeypatch):
    """ítem 9.9: Telegram reintenta la entrega con el MISMO update_id si el bot
    tardó en responder. Procesar el mismo Update dos veces no debe duplicar el
    efecto (aquí: la respuesta enviada), gracias al guarda de dedupe (group=-1)."""
    fake_db = FakeSupabase()
    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        update = command_update(app, "/estado", chat_id=901000001)
        await app.process_update(update)
        await app.process_update(update)  # "reintento" de Telegram: mismo update_id

        respuestas_no_vinculado = [s for s in api.sent if "No estás vinculado" in s.get("text", "")]
        assert len(respuestas_no_vinculado) == 1
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_rate_limit_corta_el_flood(monkeypatch):
    """ítem 9.9: más de RATE_LIMIT_MAX_UPDATES updates del mismo chat_id en la
    ventana deslizante se descartan (ApplicationHandlerStop en group=-1) —
    ningún handler "de verdad" llega a ejecutarse para los que sobran."""
    fake_db = FakeSupabase()
    app, api = make_app(monkeypatch, fake_db)
    await app.initialize()
    try:
        chat_flood = 901000002
        total_intentos = bot_module.RATE_LIMIT_MAX_UPDATES + 5
        for _ in range(total_intentos):
            await app.process_update(command_update(app, "/estado", chat_id=chat_flood))

        # Cada /estado sin chófer vinculado responde "No estás vinculado" — los
        # que exceden el límite ni siquiera llegan a cmd_estado.
        assert len(api.sent) == bot_module.RATE_LIMIT_MAX_UPDATES
    finally:
        await app.shutdown()


@pytest.mark.asyncio
async def test_e2e_foto_pod_invalida_se_rechaza(monkeypatch):
    """ítem 9.9: una "foto" cuyos bytes no empiezan con la firma JPEG (o que
    supera el tamaño máximo) se rechaza ANTES de subir nada a Storage."""
    fake_db = FakeSupabase()
    fake_db.tables["chofer"] = [{
        "id": CHOFER_ID, "nombre": "Mario", "empresa_id": "e1", "idioma": "es", "chat_id": str(CHAT_ID),
    }]
    fake_db.tables["viaje"] = [{
        "id": "v1", "chofer_id": CHOFER_ID, "empresa_id": "e1", "estado": "en_curso", "referencia": "VJ-1",
    }]
    fake_db.tables["hito"] = [{
        "id": "h2", "viaje_id": "v1", "orden": 2, "tipo": "entrega", "direccion": "Destino",
        "estado": "en_curso",
    }]

    app, api = make_app(monkeypatch, fake_db)

    async def get_file_invalido(self, file_id, **kwargs):
        class FakeFileInvalido:
            async def download_as_bytearray(self_inner, *a, **kw):
                return bytearray(b"esto-no-es-un-jpeg-de-verdad")
        return FakeFileInvalido()

    monkeypatch.setattr(type(app.bot), "get_file", get_file_invalido)

    await app.initialize()
    try:
        await app.process_update(photo_update(app))

        assert fake_db.storage.uploads == []
        assert fake_db.tables.get("pod", []) == []
        assert fake_db.tables["hito"][0]["estado"] == "en_curso"  # sin completar
        assert any("no parece válida" in s.get("text", "") for s in api.sent)
    finally:
        await app.shutdown()
