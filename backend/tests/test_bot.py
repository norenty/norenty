"""Tests del bot: lo crítico es que un chófer no pueda tocar hitos de otro
viaje (vulnerabilidad real que se corrigió en la auditoría de seguridad),
y que el flujo de mensajes/navegación se construya bien.
"""
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app import bot
from tests.fakes import FakeSupabase


@pytest.fixture
def fake_db(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(bot, "supabase", fake)
    return fake


class FakeTransporte:
    """Captura los envíos en vez de llamar a Telegram de verdad; sirve para
    verificar alertar_gestor/notificar_gestor_evento sin red y sin acoplar
    el test a la implementación de Telegram (la interfaz Transporte, Fase 4.6)."""
    def __init__(self):
        self.enviados = []

    async def enviar_texto(self, chat_id, texto):
        self.enviados.append((chat_id, texto))


@pytest.fixture
def fake_transporte(monkeypatch):
    fake = FakeTransporte()
    monkeypatch.setattr(bot, "transporte_gestor", fake)
    return fake


# --- verificar_hito_pertenece_a_chofer: la pieza de seguridad ---

def test_hito_no_encontrado(fake_db):
    hito, error = bot.verificar_hito_pertenece_a_chofer("hito-inexistente", "chofer-1")
    assert hito is None
    assert error == "Hito no encontrado."


def test_hito_de_otro_chofer_es_rechazado(fake_db):
    """El caso que antes era explotable: un chofer envía el ID de un hito
    que pertenece al viaje de OTRO chofer."""
    fake_db.tables["hito"] = [{
        "id": "hito-1",
        "tipo": "entrega",
        "direccion": "Calle Falsa 123",
        "orden": 1,
        "viaje": {"id": "viaje-1", "chofer_id": "chofer-VICTIMA", "estado": "en_curso", "referencia": "VJ-1"},
    }]
    hito, error = bot.verificar_hito_pertenece_a_chofer("hito-1", "chofer-ATACANTE")
    assert hito is None
    assert error == "Este hito no pertenece a tu viaje."


def test_hito_de_viaje_no_activo_es_rechazado(fake_db):
    fake_db.tables["hito"] = [{
        "id": "hito-1",
        "tipo": "entrega",
        "viaje": {"id": "viaje-1", "chofer_id": "chofer-1", "estado": "completado", "referencia": "VJ-1"},
    }]
    hito, error = bot.verificar_hito_pertenece_a_chofer("hito-1", "chofer-1")
    assert hito is None
    assert error == "Este viaje ya no está activo."


def test_hito_valido_del_propio_chofer_se_acepta(fake_db):
    fake_db.tables["hito"] = [{
        "id": "hito-1",
        "tipo": "entrega",
        "direccion": "Calle Real 1",
        "viaje": {"id": "viaje-1", "chofer_id": "chofer-1", "estado": "en_curso", "referencia": "VJ-1"},
    }]
    hito, error = bot.verificar_hito_pertenece_a_chofer("hito-1", "chofer-1")
    assert error is None
    assert hito["id"] == "hito-1"


def test_hito_de_viaje_planificado_tambien_se_acepta(fake_db):
    fake_db.tables["hito"] = [{
        "id": "hito-1",
        "viaje": {"id": "viaje-1", "chofer_id": "chofer-1", "estado": "planificado", "referencia": "VJ-1"},
    }]
    hito, error = bot.verificar_hito_pertenece_a_chofer("hito-1", "chofer-1")
    assert error is None


# --- get_chofer_by_chat ---

def test_get_chofer_by_chat_encontrado(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "12345"}]
    chofer = bot.get_chofer_by_chat("12345")
    assert chofer["nombre"] == "Mario"


def test_get_chofer_by_chat_no_vinculado(fake_db):
    fake_db.tables["chofer"] = []
    assert bot.get_chofer_by_chat("99999") is None


def test_get_chofer_by_chat_normaliza_a_string(fake_db):
    """chat_id en Telegram llega como int; la tabla lo guarda como texto."""
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "12345"}]
    chofer = bot.get_chofer_by_chat(12345)  # int, no str
    assert chofer is not None


# --- nav_buttons: construcción de botones de navegación ---

def test_nav_buttons_con_coordenadas():
    botones = bot.nav_buttons({"lat": 40.4, "lon": -3.7, "direccion": "Madrid"})
    assert len(botones) == 1
    urls = [b.url for b in botones[0]]
    assert any("google.com/maps" in u for u in urls)
    assert any("waze.com" in u for u in urls)


def test_nav_buttons_solo_direccion_usa_quote_plus():
    botones = bot.nav_buttons({"direccion": "Calle Mayor 1, Madrid"})
    urls = [b.url for b in botones[0]]
    assert any("Calle+Mayor" in u for u in urls)


def test_nav_buttons_sin_datos_devuelve_vacio():
    assert bot.nav_buttons({}) == []


def test_nav_buttons_con_link_extra_anade_boton():
    botones = bot.nav_buttons({"lat": 1, "lon": 1, "link_extra": "https://parking.example.com"})
    assert len(botones) == 2
    assert botones[1][0].url == "https://parking.example.com"


# --- build_hito_message ---

def test_build_hito_message_recogida():
    msg = bot.build_hito_message({"tipo": "recogida", "direccion": "Origen X"}, 1, 3)
    assert "RECOGIDA" in msg
    assert "Origen X" in msg
    assert "1/3" in msg


def test_build_hito_message_entrega():
    msg = bot.build_hito_message({"tipo": "entrega", "direccion": "Destino Y"}, 2, 3)
    assert "ENTREGA" in msg


def test_build_hito_message_incluye_ventana():
    msg = bot.build_hito_message(
        {"tipo": "entrega", "direccion": "X", "ventana_inicio": "08:00", "ventana_fin": "10:00"}, 1, 1
    )
    assert "08:00" in msg and "10:00" in msg


def test_build_hito_message_incluye_notas():
    msg = bot.build_hito_message({"tipo": "entrega", "direccion": "X", "notas": "Llamar al timbre 2B"}, 1, 1)
    assert "Llamar al timbre 2B" in msg


# --- t(): helper de localización ---

def test_t_espanol_por_defecto():
    assert bot.t("es", "btn_llegado") == "He llegado"


def test_t_ingles():
    assert bot.t("en", "btn_llegado") == "I've arrived"


def test_t_rumano():
    assert bot.t("ro", "btn_llegado") == "Am ajuns"


def test_t_frances():
    assert bot.t("fr", "btn_llegado") == "Je suis arrivé"


def test_t_italiano():
    assert bot.t("it", "btn_llegado") == "Sono arrivato"


def test_t_portugues():
    assert bot.t("pt", "btn_llegado") == "Cheguei"


def test_t_aleman():
    assert bot.t("de", "btn_llegado") == "Ich bin angekommen"


def test_t_arabe():
    assert bot.t("ar", "btn_llegado") == "لقد وصلت"


def test_t_ar_it_pt_de_ya_no_son_alias_de_ingles():
    # 6.19: ar/it/pt/de tenian traduccion real solo desde 2026-07-13;
    # antes eran el mismo dict que "en" (TEXTOS.setdefault(_lang, TEXTOS["en"])).
    for lang in ("ar", "it", "pt", "de"):
        assert bot.TEXTOS[lang] is not bot.TEXTOS["en"]
        assert bot.TEXTOS[lang]["btn_llegado"] != bot.TEXTOS["en"]["btn_llegado"]


def test_todos_los_idiomas_tienen_las_mismas_claves():
    claves_es = set(bot.TEXTOS["es"].keys())
    for lang, textos in bot.TEXTOS.items():
        assert set(textos.keys()) == claves_es, f"{lang} tiene claves distintas de es"


def test_t_idioma_desconocido_usa_espanol_como_fallback():
    # Idioma totalmente desconocido -> fallback al español (idioma base del producto)
    resultado = bot.t("zz", "btn_llegado")
    assert resultado == bot.t("es", "btn_llegado")


def test_t_acepta_dict_chofer():
    chofer = {"idioma": "ro", "nombre": "Ion"}
    assert bot.t(chofer, "btn_llegado") == "Am ajuns"


def test_t_chofer_sin_idioma_usa_espanol():
    chofer = {"nombre": "Mario"}  # sin campo idioma
    assert bot.t(chofer, "btn_llegado") == "He llegado"


def test_t_con_kwargs_sustituye_valores():
    msg = bot.t("es", "viaje_completado", ref="VJ-001", total=3)
    assert "VJ-001" in msg
    assert "3" in msg


def test_t_clave_inexistente_devuelve_fallback_espanol():
    # Si en 'en' falta una clave pero existe en 'es', devuelve el de 'es'
    resultado = bot.t("en", "incidencia_ok", ref="X")
    assert "X" in resultado


# --- build_hito_message con idioma ---

def test_build_hito_message_en_ingles():
    msg = bot.build_hito_message({"tipo": "recogida", "direccion": "London Dock"}, 1, 2, idioma="en")
    assert "PICKUP" in msg
    assert "London Dock" in msg


def test_build_hito_message_en_rumano():
    msg = bot.build_hito_message({"tipo": "entrega", "direccion": "Strada Mare"}, 2, 3, idioma="ro")
    assert "LIVRARE" in msg


def test_build_hito_message_sin_idioma_usa_espanol():
    msg = bot.build_hito_message({"tipo": "recogida", "direccion": "X"}, 1, 1)
    assert "RECOGIDA" in msg


# --- vincular_gestor: alta de Telegram del gestor (Fase 2) ---

def fake_update():
    return SimpleNamespace(message=SimpleNamespace(reply_text=AsyncMock()))


@pytest.mark.asyncio
async def test_vincular_gestor_no_encontrado(fake_db):
    update = fake_update()
    await bot.vincular_gestor(update, "gestor-inexistente", "chat-1")
    texto = update.message.reply_text.call_args[0][0]
    assert "No encuentro esa cuenta de gestor" in texto


@pytest.mark.asyncio
async def test_vincular_gestor_exito(fake_db):
    fake_db.tables["gestor"] = [{"id": "g1", "nombre": "Ana", "telegram_chat_id": None}]
    update = fake_update()
    await bot.vincular_gestor(update, "g1", "chat-1")
    texto = update.message.reply_text.call_args[0][0]
    assert "Vinculado correctamente, Ana" in texto
    assert fake_db.tables["gestor"][0]["telegram_chat_id"] == "chat-1"


@pytest.mark.asyncio
async def test_vincular_gestor_ya_vinculado_a_otro_chat(fake_db):
    fake_db.tables["gestor"] = [{"id": "g1", "nombre": "Ana", "telegram_chat_id": "chat-VIEJO"}]
    update = fake_update()
    await bot.vincular_gestor(update, "g1", "chat-NUEVO")
    texto = update.message.reply_text.call_args[0][0]
    assert "ya está vinculada a otro Telegram" in texto
    assert fake_db.tables["gestor"][0]["telegram_chat_id"] == "chat-VIEJO"  # no se sobreescribe


@pytest.mark.asyncio
async def test_vincular_gestor_revincular_mismo_chat_es_idempotente(fake_db):
    fake_db.tables["gestor"] = [{"id": "g1", "nombre": "Ana", "telegram_chat_id": "chat-1"}]
    update = fake_update()
    await bot.vincular_gestor(update, "g1", "chat-1")
    texto = update.message.reply_text.call_args[0][0]
    assert "Vinculado correctamente, Ana" in texto


@pytest.mark.asyncio
async def test_cmd_start_con_prefijo_gestor_enruta_correctamente(fake_db, monkeypatch):
    fake_db.tables["gestor"] = [{"id": "g1", "nombre": "Ana", "telegram_chat_id": None}]
    update = SimpleNamespace(
        effective_chat=SimpleNamespace(id="chat-1"),
        message=SimpleNamespace(reply_text=AsyncMock()),
    )
    ctx = SimpleNamespace(args=["gestor_g1"], bot=AsyncMock())
    await bot.cmd_start(update, ctx)
    assert fake_db.tables["gestor"][0]["telegram_chat_id"] == "chat-1"


# --- Menú de botones rápidos (Fase 4.1) ---

def fake_menu_update(texto, chat_id="chat-1"):
    return SimpleNamespace(
        effective_chat=SimpleNamespace(id=chat_id),
        message=SimpleNamespace(text=texto, reply_text=AsyncMock()),
    )


def test_menu_keyboard_incluye_los_tres_botones():
    chofer = {"idioma": "es"}
    teclado = bot.menu_keyboard(chofer)
    # 2026-07-23: una fila por botón (más grandes en móvil, ver menu_keyboard),
    # ya no una sola fila con los 3 -- se aplana para no depender del layout.
    textos = [b.text for fila in teclado.keyboard for b in fila]
    assert "📍 Reportar incidencia" in textos
    assert "📋 Mi viaje" in textos
    assert "📞 Contactar gestor" in textos


@pytest.mark.asyncio
async def test_handle_menu_texto_boton_incidencia_muestra_ayuda(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    update = fake_menu_update("📍 Reportar incidencia")
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_menu_texto(update, ctx)
    # 2026-07-23: el botón ⚠️ ahora abre el selector de tipo de un toque, ya no
    # pide que escriban "/incidencia". Debe mostrar la cabecera y un teclado.
    texto = update.message.reply_text.call_args[0][0]
    assert "¿Qué ha pasado?" in texto
    assert update.message.reply_text.call_args.kwargs.get("reply_markup") is not None


@pytest.mark.asyncio
async def test_handle_menu_texto_boton_mi_viaje_llama_send_next_hito(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    update = fake_menu_update("📋 Mi viaje")
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_menu_texto(update, ctx)
    ctx.bot.send_message.assert_awaited_once()
    assert "No tienes ningún viaje activo" in ctx.bot.send_message.call_args.kwargs["text"]


@pytest.mark.asyncio
async def test_send_next_hito_al_completar_manda_resumen_de_ruta_sin_datos(fake_db):
    # F14.5: sin ejecucion_evento previo -> no hay "inicio" del viaje -> el
    # resumen se manda igual, pero honesto sobre la falta de datos de GPS.
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"id": "h1", "viaje_id": "v1", "orden": 1, "estado": "completado"},
        {"id": "h2", "viaje_id": "v1", "orden": 2, "estado": "completado"},
    ]
    fake_db.tables["gestor"] = []
    update = fake_menu_update("📋 Mi viaje")
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_menu_texto(update, ctx)

    assert ctx.bot.send_message.await_count == 2
    primero = ctx.bot.send_message.call_args_list[0].kwargs["text"]
    segundo = ctx.bot.send_message.call_args_list[1].kwargs["text"]
    assert "completado" in primero
    assert "Sin datos de GPS suficientes" in segundo
    assert fake_db.tables["viaje"][0]["estado"] == "completado"


@pytest.mark.asyncio
async def test_send_next_hito_al_completar_manda_resumen_de_ruta_con_km_y_horas(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"id": "h1", "viaje_id": "v1", "orden": 1, "estado": "completado"},
        {"id": "h2", "viaje_id": "v1", "orden": 2, "estado": "completado"},
    ]
    fake_db.tables["ejecucion_evento"] = [
        {"viaje_id": "v1", "chofer_id": "c1", "tipo": "llegada", "ocurrido_en": "2026-01-01T09:00:00Z"},
    ]
    fake_db.tables["ubicacion"] = [
        {"chofer_id": "c1", "lat": 40.0, "lon": -3.0, "created_at": "2026-01-01T10:00:00Z"},
        {"chofer_id": "c1", "lat": 40.5, "lon": -3.0, "created_at": "2026-01-01T10:30:00Z"},
    ]
    fake_db.tables["empresa"] = [{"id": "e1", "velocidad_planificacion_kmh": 75}]
    fake_db.tables["gestor"] = []
    update = fake_menu_update("📋 Mi viaje")
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_menu_texto(update, ctx)

    segundo = ctx.bot.send_message.call_args_list[1].kwargs["text"]
    assert "Resumen de tu ruta" in segundo
    assert "2 paradas" in segundo


@pytest.mark.asyncio
async def test_handle_menu_texto_boton_contactar_con_telefono_ofrece_llamada(fake_db):
    # 2026-07-23: "Contactar gestor" ya no enseña solo un email -- abre la
    # captura de texto/voz (mensaje real al gestor por el bot) y, si hay
    # telefono configurado, además ofrece un botón de llamada de emergencia.
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "nombre": "Ana", "email": "ana@norenty.com", "telefono": "+34600111222"}]
    update = fake_menu_update("📞 Contactar gestor")
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_menu_texto(update, ctx)
    texto = update.message.reply_text.call_args[0][0]
    assert "mensaje" in texto.lower() or "nota de voz" in texto.lower()
    teclado = update.message.reply_text.call_args.kwargs.get("reply_markup")
    assert teclado is not None
    assert "tel:+34600111222" in teclado.inline_keyboard[0][0].url
    assert ctx.chat_data.get("contactar_pendiente") is not None


@pytest.mark.asyncio
async def test_handle_menu_texto_boton_contactar_sin_telefono_no_ofrece_llamada(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "nombre": "Ana", "email": "ana@norenty.com"}]
    update = fake_menu_update("📞 Contactar gestor")
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_menu_texto(update, ctx)
    assert update.message.reply_text.call_args.kwargs.get("reply_markup") is None


@pytest.mark.asyncio
async def test_handle_menu_texto_mensaje_libre_tras_contactar_llega_al_gestor(fake_db, fake_transporte):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": "gchat-1", "activo": True, "notif_incidencias": True}]
    update = fake_menu_update("necesito que me cambien de ruta, hay un corte")
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={"contactar_pendiente": {"hasta": time.time() + 100, "viaje_id": None}})
    await bot.handle_menu_texto(update, ctx)
    assert "contactar_pendiente" not in ctx.chat_data
    assert any("corte" in texto for _chat, texto in fake_transporte.enviados)
    fila = fake_db.tables["mensaje_chofer"][0]
    assert fila["direccion"] == "chofer_a_gestor"
    assert fila["entregado_en"] is not None


@pytest.mark.asyncio
async def test_handle_menu_texto_chofer_no_vinculado_no_responde(fake_db):
    fake_db.tables["chofer"] = []
    update = fake_menu_update("📋 Mi viaje")
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_menu_texto(update, ctx)
    update.message.reply_text.assert_not_called()
    ctx.bot.send_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_handle_menu_texto_texto_desconocido_no_responde(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    update = fake_menu_update("hola, todo bien")
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_menu_texto(update, ctx)
    update.message.reply_text.assert_not_called()


# --- Transporte: abstracción de mensajería al gestor (Fase 4.6) ---

@pytest.mark.asyncio
async def test_alertar_gestor_crea_incidencia_y_usa_el_transporte(fake_db, fake_transporte):
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-1", "activo": True, "notif_incidencias": True}]
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1"}]

    await bot.alertar_gestor("e1", "v1", "averia", "Rueda pinchada")

    assert fake_db.tables["incidencia"][0]["tipo"] == "averia"
    assert len(fake_transporte.enviados) == 1
    chat, texto = fake_transporte.enviados[0]
    assert chat == "chat-1"
    assert "VJ-1" in texto
    assert "AVERIA" in texto or "AVERÍA" in texto


@pytest.mark.asyncio
async def test_alertar_gestor_no_envia_a_gestores_sin_telegram(fake_db, fake_transporte):
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None, "activo": True, "notif_incidencias": True}]
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1"}]

    await bot.alertar_gestor("e1", "v1", "otro", "texto")

    assert fake_transporte.enviados == []


@pytest.mark.asyncio
async def test_notificar_gestor_evento_usa_el_transporte(fake_db, fake_transporte):
    fake_db.tables["gestor"] = [
        {"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-1", "activo": True, "notif_entregas": True},
        {"id": "g2", "empresa_id": "e1", "telegram_chat_id": "chat-2", "activo": True, "notif_entregas": True},
    ]

    await bot.notificar_gestor_evento("e1", "v1", "Mensaje de prueba")

    assert fake_transporte.enviados == [("chat-1", "Mensaje de prueba"), ("chat-2", "Mensaje de prueba")]


# --- R2 (2026-07-15): las preferencias de notificación dejan de ser decorativas ---

@pytest.mark.asyncio
async def test_alertar_gestor_no_avisa_a_gestor_inactivo(fake_db, fake_transporte):
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-1", "activo": False, "notif_incidencias": True}]
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1"}]

    await bot.alertar_gestor("e1", "v1", "otro", "texto")

    assert fake_transporte.enviados == []


@pytest.mark.asyncio
async def test_alertar_gestor_respeta_notif_incidencias_desactivada(fake_db, fake_transporte):
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-1", "activo": True, "notif_incidencias": False}]
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1"}]

    await bot.alertar_gestor("e1", "v1", "otro", "texto")

    assert fake_transporte.enviados == []


@pytest.mark.asyncio
async def test_alertar_gestor_fuera_de_ventana_usa_su_propia_preferencia(fake_db, fake_transporte):
    # notif_incidencias=False pero notif_fuera_ventana=True -- SÍ debe avisar,
    # es la columna correcta para este tipo (columna_pref_notificacion).
    fake_db.tables["gestor"] = [{
        "id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-1",
        "activo": True, "notif_incidencias": False, "notif_fuera_ventana": True,
    }]
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1"}]

    await bot.alertar_gestor("e1", "v1", "fuera_de_ventana", "Llegó tarde")

    assert len(fake_transporte.enviados) == 1


@pytest.mark.asyncio
async def test_notificar_gestor_evento_respeta_notif_entregas_desactivada(fake_db, fake_transporte):
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-1", "activo": True, "notif_entregas": False}]

    await bot.notificar_gestor_evento("e1", "v1", "Mensaje de prueba")

    assert fake_transporte.enviados == []


# --- Fase 15 (2026-07-15, hallazgo posterior a F15.2): las alertas por
# Telegram deben respetar el mismo scoping por gestor_id que la RLS de
# chofer/viaje -- si no, un gestor no asignado se enteraba por Telegram de
# viajes que ni siquiera puede ver en su propio dashboard. ---

@pytest.mark.asyncio
async def test_alertar_gestor_no_avisa_a_gestor_no_asignado_si_el_viaje_tiene_dueño(fake_db, fake_transporte):
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1", "gestor_id": "g-asignado"}]
    fake_db.tables["gestor"] = [{
        "id": "g-otro", "empresa_id": "e1", "telegram_chat_id": "chat-ajeno",
        "activo": True, "notif_incidencias": True, "rol": "gestor_operativo",
    }]

    await bot.alertar_gestor("e1", "v1", "otro", "texto")

    assert fake_transporte.enviados == []


@pytest.mark.asyncio
async def test_alertar_gestor_avisa_al_gestor_asignado(fake_db, fake_transporte):
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1", "gestor_id": "g-asignado"}]
    fake_db.tables["gestor"] = [
        {"id": "g-asignado", "empresa_id": "e1", "telegram_chat_id": "chat-asignado", "activo": True, "notif_incidencias": True, "rol": "gestor_operativo"},
        {"id": "g-otro", "empresa_id": "e1", "telegram_chat_id": "chat-ajeno", "activo": True, "notif_incidencias": True, "rol": "gestor_operativo"},
    ]

    await bot.alertar_gestor("e1", "v1", "otro", "texto")

    assert len(fake_transporte.enviados) == 1
    assert fake_transporte.enviados[0][0] == "chat-asignado"


@pytest.mark.asyncio
async def test_alertar_gestor_avisa_a_admin_aunque_no_sea_el_asignado(fake_db, fake_transporte):
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1", "gestor_id": "g-asignado"}]
    fake_db.tables["gestor"] = [
        {"id": "g-admin", "empresa_id": "e1", "telegram_chat_id": "chat-admin", "activo": True, "notif_incidencias": True, "rol": "admin"},
    ]

    await bot.alertar_gestor("e1", "v1", "otro", "texto")

    assert len(fake_transporte.enviados) == 1


@pytest.mark.asyncio
async def test_alertar_gestor_sin_gestor_id_en_el_viaje_avisa_a_todos_los_de_la_preferencia(fake_db, fake_transporte):
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1", "gestor_id": None}]
    fake_db.tables["gestor"] = [
        {"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-1", "activo": True, "notif_incidencias": True, "rol": "gestor_operativo"},
        {"id": "g2", "empresa_id": "e1", "telegram_chat_id": "chat-2", "activo": True, "notif_incidencias": True, "rol": "gestor_operativo"},
    ]

    await bot.alertar_gestor("e1", "v1", "otro", "texto")

    assert len(fake_transporte.enviados) == 2


# --- /parking (ítem 6.7) ---

MADRID = (40.4168, -3.7038)
BARCELONA = (41.3851, 2.1734)


def test_haversine_km_madrid_barcelona_es_realista():
    # Distancia real en línea recta Madrid-Barcelona: ~500 km.
    d = bot.haversine_km(*MADRID, *BARCELONA)
    assert 490 < d < 510


def test_haversine_km_mismo_punto_es_cero():
    assert bot.haversine_km(*MADRID, *MADRID) == 0


def test_obtener_ubicacion_chofer_prefiere_tabla_ubicacion(fake_db):
    fake_db.tables["ubicacion"] = [
        {"chofer_id": "c1", "lat": 1.0, "lon": 2.0, "created_at": "2026-01-01T10:00:00Z"},
        {"chofer_id": "c1", "lat": 9.0, "lon": 9.0, "created_at": "2026-01-02T10:00:00Z"},  # más reciente
    ]
    punto = bot.obtener_ubicacion_chofer({"id": "c1"})
    assert punto == (9.0, 9.0)


def test_obtener_ubicacion_chofer_cae_a_ultimo_hito_completado_si_no_hay_ubicacion(fake_db):
    fake_db.tables["ubicacion"] = []
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"viaje_id": "v1", "orden": 1, "estado": "completado", "lat": 1.0, "lon": 1.0},
        {"viaje_id": "v1", "orden": 2, "estado": "completado", "lat": 2.0, "lon": 2.0},  # último completado
        {"viaje_id": "v1", "orden": 3, "estado": "pendiente", "lat": 3.0, "lon": 3.0},
    ]
    punto = bot.obtener_ubicacion_chofer({"id": "c1"})
    assert punto == (2.0, 2.0)


def test_obtener_ubicacion_chofer_none_si_no_hay_senal(fake_db):
    fake_db.tables["ubicacion"] = []
    fake_db.tables["viaje"] = []
    assert bot.obtener_ubicacion_chofer({"id": "c1"}) is None


# --- empresa_requiere_pod: conecta empresa.requiere_pod (existía desde el
# Milestone 3, nunca se usaba en ningún sitio) ---

def test_empresa_requiere_pod_true_explicito(fake_db):
    fake_db.tables["empresa"] = [{"id": "e1", "requiere_pod": True}]
    assert bot.empresa_requiere_pod("e1") is True


def test_empresa_requiere_pod_false_explicito(fake_db):
    fake_db.tables["empresa"] = [{"id": "e1", "requiere_pod": False}]
    assert bot.empresa_requiere_pod("e1") is False


def test_empresa_requiere_pod_default_true_si_no_hay_fila(fake_db):
    fake_db.tables["empresa"] = []
    assert bot.empresa_requiere_pod("e1") is True


def test_empresa_requiere_pod_default_true_si_valor_null(fake_db):
    fake_db.tables["empresa"] = [{"id": "e1", "requiere_pod": None}]
    assert bot.empresa_requiere_pod("e1") is True


@pytest.mark.asyncio
async def test_cmd_parking_no_vinculado(fake_db):
    fake_db.tables["chofer"] = []
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    ctx = SimpleNamespace()
    await bot.cmd_parking(update, ctx)
    texto = update.message.reply_text.call_args[0][0]
    assert "No estás vinculado" in texto


@pytest.mark.asyncio
async def test_cmd_parking_sin_ubicacion(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["ubicacion"] = []
    fake_db.tables["viaje"] = []
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    ctx = SimpleNamespace()
    await bot.cmd_parking(update, ctx)
    texto = update.message.reply_text.call_args[0][0]
    assert "No tengo tu ubicación todavía" in texto


@pytest.mark.asyncio
async def test_cmd_parking_devuelve_los_3_mas_cercanos_ordenados(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["ubicacion"] = [{"chofer_id": "c1", "lat": MADRID[0], "lon": MADRID[1], "created_at": "2026-01-01T10:00:00Z"}]
    # 4 parkings: 3 propios de e1 (a distintas distancias de Madrid) + 1 del dataset abierto.
    fake_db.tables["parking"] = [
        {"id": "p1", "empresa_id": "e1", "nombre": "Mi parking cercano", "tipo": "parking", "lat": 40.42, "lon": -3.71, "fuente": "empresa"},
        {"id": "p2", "empresa_id": "e1", "nombre": "Mi parking lejano", "tipo": "parking", "lat": 42.0, "lon": -3.0, "fuente": "empresa"},
        {"id": "p3", "empresa_id": "e2", "nombre": "Parking de otra empresa", "tipo": "parking", "lat": 40.42, "lon": -3.70, "fuente": "empresa"},
        {"id": "p4", "empresa_id": None, "nombre": "Rest Area", "tipo": "rest_area", "lat": 40.5, "lon": -3.72, "fuente": "dataset_abierto"},
    ]
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    ctx = SimpleNamespace()
    await bot.cmd_parking(update, ctx)

    texto = update.message.reply_text.call_args[0][0]
    reply_markup = update.message.reply_text.call_args[1]["reply_markup"]

    assert "Mi parking cercano" in texto  # el más cercano de la empresa
    assert "Área de descanso" in texto  # el del dataset abierto, tipo localizado
    assert "Parking de otra empresa" not in texto  # nunca datos de OTRA empresa
    assert len(reply_markup.inline_keyboard) == 3  # top 3, no los 4


@pytest.mark.asyncio
async def test_cmd_parking_sin_resultados(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["ubicacion"] = [{"chofer_id": "c1", "lat": MADRID[0], "lon": MADRID[1], "created_at": "2026-01-01T10:00:00Z"}]
    fake_db.tables["parking"] = []
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    ctx = SimpleNamespace()
    await bot.cmd_parking(update, ctx)
    texto = update.message.reply_text.call_args[0][0]
    assert "No encontré parkings cercanos" in texto


@pytest.mark.asyncio
async def test_cmd_parking_en_ingles(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "John", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "en"}]
    fake_db.tables["ubicacion"] = [{"chofer_id": "c1", "lat": MADRID[0], "lon": MADRID[1], "created_at": "2026-01-01T10:00:00Z"}]
    fake_db.tables["parking"] = [
        {"id": "p1", "empresa_id": "e1", "nombre": "My parking", "tipo": "fueling", "lat": 40.42, "lon": -3.71, "fuente": "empresa"},
    ]
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    ctx = SimpleNamespace()
    await bot.cmd_parking(update, ctx)
    texto = update.message.reply_text.call_args[0][0]
    assert "Nearby parkings" in texto
    reply_markup = update.message.reply_text.call_args[1]["reply_markup"]
    assert "Directions" in reply_markup.inline_keyboard[0][0].text


# --- /eta (ítem 6.8) — calcular_eta_con_paradas: mismos casos que el JS (5.3) ---

def test_calcular_eta_0h_sin_paradas():
    r = bot.calcular_eta_con_paradas(0)
    assert r == {"horas_totales": 0, "paradas_45min": 0, "descansos_11h": 0}


def test_calcular_eta_por_debajo_de_4_5h_sin_paradas():
    r = bot.calcular_eta_con_paradas(3)
    assert r == {"horas_totales": 3, "paradas_45min": 0, "descansos_11h": 0}


def test_calcular_eta_5h_una_pausa():
    r = bot.calcular_eta_con_paradas(5)
    assert r["paradas_45min"] == 1
    assert r["descansos_11h"] == 0
    assert round(r["horas_totales"], 5) == 5.75


def test_calcular_eta_9h_exactas_una_pausa_sin_descanso():
    r = bot.calcular_eta_con_paradas(9)
    assert r["paradas_45min"] == 1
    assert r["descansos_11h"] == 0
    assert round(r["horas_totales"], 5) == 9.75


def test_calcular_eta_10h_supera_limite_diario_pausa_y_descanso():
    r = bot.calcular_eta_con_paradas(10)
    assert r["paradas_45min"] == 1
    assert r["descansos_11h"] == 1
    assert round(r["horas_totales"], 5) == 21.75


def test_calcular_eta_18h_dos_dias_completos():
    r = bot.calcular_eta_con_paradas(18)
    assert r["paradas_45min"] == 2
    assert r["descansos_11h"] == 1
    assert round(r["horas_totales"], 5) == 30.5


# --- /eta — cmd_eta: integración con el bot ---

@pytest.mark.asyncio
async def test_cmd_eta_no_vinculado(fake_db):
    fake_db.tables["chofer"] = []
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    await bot.cmd_eta(update, SimpleNamespace())
    texto = update.message.reply_text.call_args[0][0]
    assert "No estás vinculado" in texto


@pytest.mark.asyncio
async def test_cmd_eta_sin_viaje_activo(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["viaje"] = []
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    await bot.cmd_eta(update, SimpleNamespace())
    texto = update.message.reply_text.call_args[0][0]
    assert "No tienes ningún viaje activo" in texto


@pytest.mark.asyncio
async def test_cmd_eta_sin_hitos_suficientes(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [{"viaje_id": "v1", "orden": 1, "estado": "completado", "lat": 1.0, "lon": 1.0}]
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    await bot.cmd_eta(update, SimpleNamespace())
    texto = update.message.reply_text.call_args[0][0]
    assert "No tengo suficientes datos de ruta" in texto


@pytest.mark.asyncio
async def test_cmd_eta_calcula_con_velocidad_de_empresa(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    # Hito 1 completado (ya no cuenta) + 2 pendientes -> 1 tramo entre los 2 restantes.
    fake_db.tables["hito"] = [
        {"viaje_id": "v1", "orden": 1, "estado": "completado", "lat": 40.0, "lon": -3.0},
        {"viaje_id": "v1", "orden": 2, "estado": "en_curso", "lat": 40.0, "lon": -3.0},
        {"viaje_id": "v1", "orden": 3, "estado": "pendiente", "lat": 40.9, "lon": -3.0},  # ~100km al norte
    ]
    fake_db.tables["empresa"] = [{"id": "e1", "velocidad_planificacion_kmh": 100}]
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    await bot.cmd_eta(update, SimpleNamespace())
    texto = update.message.reply_text.call_args[0][0]
    assert "100 km/h" in texto
    assert "Total:" in texto


@pytest.mark.asyncio
async def test_cmd_eta_usa_velocidad_por_defecto_si_empresa_no_la_configura(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"viaje_id": "v1", "orden": 1, "estado": "pendiente", "lat": 40.0, "lon": -3.0},
        {"viaje_id": "v1", "orden": 2, "estado": "pendiente", "lat": 40.9, "lon": -3.0},
    ]
    fake_db.tables["empresa"] = [{"id": "e1", "velocidad_planificacion_kmh": None}]
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    await bot.cmd_eta(update, SimpleNamespace())
    texto = update.message.reply_text.call_args[0][0]
    assert "75 km/h" in texto


@pytest.mark.asyncio
async def test_cmd_eta_en_ingles_y_pluralizacion(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "John", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "en"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    # Suficiente distancia para necesitar >1 pausa (varios hitos muy separados).
    fake_db.tables["hito"] = [
        {"viaje_id": "v1", "orden": 1, "estado": "pendiente", "lat": 36.0, "lon": -6.0},
        {"viaje_id": "v1", "orden": 2, "estado": "pendiente", "lat": 40.0, "lon": -3.0},
        {"viaje_id": "v1", "orden": 3, "estado": "pendiente", "lat": 43.5, "lon": -5.7},
    ]
    fake_db.tables["empresa"] = [{"id": "e1", "velocidad_planificacion_kmh": 50}]
    update = SimpleNamespace(effective_chat=SimpleNamespace(id="chat-1"), message=SimpleNamespace(reply_text=AsyncMock()))
    await bot.cmd_eta(update, SimpleNamespace())
    texto = update.message.reply_text.call_args[0][0]
    assert "Estimated remaining time" in texto
    assert "driving" in texto


# --- procesar_notificaciones_asignacion (7A.3): job de aviso al chófer, sin
# aceptar/rechazar — la decisión ya la tomó el gestor (7A.2). ---

@pytest.mark.asyncio
async def test_procesar_notificaciones_envia_y_marca(fake_db):
    fake_db.tables["viaje"] = [
        {"id": "v1", "referencia": "REF1", "chofer_id": "c1", "estado": "planificado", "notificado_asignacion_en": None},
    ]
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["hito"] = [
        {"viaje_id": "v1", "orden": 1, "lat": 40.0, "lon": -3.0, "direccion": "Madrid"},
        {"viaje_id": "v1", "orden": 2, "lat": 40.9, "lon": -3.0, "direccion": "Segovia"},
    ]
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.procesar_notificaciones_asignacion(ctx)

    ctx.bot.send_message.assert_awaited_once()
    assert ctx.bot.send_message.call_args.kwargs["chat_id"] == "chat-1"
    assert "REF1" in ctx.bot.send_message.call_args.kwargs["text"]
    assert fake_db.tables["viaje"][0]["notificado_asignacion_en"] is not None


@pytest.mark.asyncio
async def test_procesar_notificaciones_chofer_sin_chat_id_notifica_gestor(fake_db, fake_transporte):
    fake_db.tables["viaje"] = [
        {"id": "v1", "referencia": "REF1", "chofer_id": "c1", "estado": "planificado", "notificado_asignacion_en": None},
    ]
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": None, "empresa_id": "e1"}]
    fake_db.tables["gestor"] = [{"empresa_id": "e1", "telegram_chat_id": "gestor-chat", "activo": True, "notif_entregas": True}]
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.procesar_notificaciones_asignacion(ctx)

    ctx.bot.send_message.assert_not_awaited()
    assert fake_db.tables["viaje"][0]["notificado_asignacion_en"] is not None
    assert len(fake_transporte.enviados) == 1
    assert "Mario" in fake_transporte.enviados[0][1]


@pytest.mark.asyncio
async def test_procesar_notificaciones_chofer_y_gestor_sin_alcance_no_marca_avisado(fake_db, fake_transporte):
    """Hallazgo 2026-07-15: si el chófer no tiene Telegram Y tampoco hay
    ningún gestor notificable (aquí: notif_entregas desactivada), antes se
    marcaba `notificado_asignacion_en` igualmente -- el viaje quedaba
    "avisado" sin que nadie se hubiera enterado. Ahora se deja sin marcar
    para que el siguiente tick lo reintente."""
    fake_db.tables["viaje"] = [
        {"id": "v1", "referencia": "REF1", "chofer_id": "c1", "estado": "planificado", "notificado_asignacion_en": None},
    ]
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": None, "empresa_id": "e1"}]
    fake_db.tables["gestor"] = [{"empresa_id": "e1", "telegram_chat_id": "gestor-chat", "activo": True, "notif_entregas": False}]
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.procesar_notificaciones_asignacion(ctx)

    assert fake_transporte.enviados == []
    assert fake_db.tables["viaje"][0]["notificado_asignacion_en"] is None  # se reintentará


@pytest.mark.asyncio
async def test_procesar_notificaciones_nada_pendiente_no_hace_nada(fake_db):
    fake_db.tables["viaje"] = [
        {"id": "v1", "referencia": "REF1", "chofer_id": "c1", "estado": "planificado", "notificado_asignacion_en": "2026-01-01T00:00:00+00:00"},
    ]
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.procesar_notificaciones_asignacion(ctx)
    ctx.bot.send_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_procesar_notificaciones_ignora_viajes_sin_chofer(fake_db):
    fake_db.tables["viaje"] = [
        {"id": "v1", "referencia": "REF1", "chofer_id": None, "estado": "planificado", "notificado_asignacion_en": None},
    ]
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.procesar_notificaciones_asignacion(ctx)
    ctx.bot.send_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_procesar_notificaciones_ignora_viajes_completados(fake_db):
    fake_db.tables["viaje"] = [
        {"id": "v1", "referencia": "REF1", "chofer_id": "c1", "estado": "completado", "notificado_asignacion_en": None},
    ]
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.procesar_notificaciones_asignacion(ctx)
    ctx.bot.send_message.assert_not_awaited()


# --- debe_guardar_ubicacion (UBI.1): sub-muestreo de la escritura ---

def test_debe_guardar_ubicacion_sin_punto_previo_siempre_guarda():
    assert bot.debe_guardar_ubicacion(None, 40.0, -3.0) is True


def test_debe_guardar_ubicacion_reciente_y_cerca_no_guarda():
    ahora = datetime(2026, 1, 1, 10, 1, 0, tzinfo=timezone.utc)  # +60s, +0m
    ultimo = {"lat": 40.0, "lon": -3.0, "created_at": "2026-01-01T10:00:00Z"}
    assert bot.debe_guardar_ubicacion(ultimo, 40.0, -3.0, ahora=ahora) is False


def test_debe_guardar_ubicacion_tras_el_intervalo_guarda_aunque_no_se_mueva():
    ahora = datetime(2026, 1, 1, 10, 3, 0, tzinfo=timezone.utc)  # +180s >= 120s
    ultimo = {"lat": 40.0, "lon": -3.0, "created_at": "2026-01-01T10:00:00Z"}
    assert bot.debe_guardar_ubicacion(ultimo, 40.0, -3.0, ahora=ahora) is True


def test_debe_guardar_ubicacion_movimiento_grande_guarda_aunque_sea_pronto():
    ahora = datetime(2026, 1, 1, 10, 0, 30, tzinfo=timezone.utc)  # +30s < 120s
    ultimo = {"lat": 40.0, "lon": -3.0, "created_at": "2026-01-01T10:00:00Z"}
    # ~0.3 grados de longitud a esta latitud son varios km, muy por encima de 200m
    assert bot.debe_guardar_ubicacion(ultimo, 40.0, -2.7, ahora=ahora) is True


# --- punto_en_checkpoint (CHK.4): detección pura de checkpoint ---

def test_punto_en_checkpoint_dentro_del_radio_propio():
    hito = {"lat": 40.0, "lon": -3.0, "radio_m": 500}
    assert bot.punto_en_checkpoint(40.001, -3.0, hito) is True


def test_punto_en_checkpoint_fuera_del_radio_propio():
    hito = {"lat": 40.0, "lon": -3.0, "radio_m": 50}
    assert bot.punto_en_checkpoint(41.0, -3.0, hito) is False


def test_punto_en_checkpoint_sin_radio_cae_al_umbral_por_defecto():
    hito = {"lat": 40.0, "lon": -3.0, "radio_m": None}
    # UMBRAL_GEO_LLEGADA_M es 300 -- un punto a ~30m debe caer dentro.
    assert bot.punto_en_checkpoint(40.0003, -3.0, hito) is True


# --- debe_avisar_pausa / horas_conduccion_estimadas_viaje (F13.5) ---

def test_debe_avisar_pausa_por_debajo_del_umbral_no_avisa():
    assert bot.debe_avisar_pausa(4.0, False) is False


def test_debe_avisar_pausa_en_o_por_encima_del_umbral_avisa():
    assert bot.debe_avisar_pausa(4.5, False) is True
    assert bot.debe_avisar_pausa(5.0, False) is True


def test_debe_avisar_pausa_ya_avisado_no_repite():
    assert bot.debe_avisar_pausa(6.0, True) is False


def test_horas_conduccion_estimadas_viaje_suma_distancias_entre_pings(fake_db):
    fake_db.tables["ubicacion"] = [
        {"chofer_id": "c1", "lat": 40.0, "lon": -3.0, "created_at": "2026-01-01T10:00:00Z"},
        {"chofer_id": "c1", "lat": 40.5, "lon": -3.0, "created_at": "2026-01-01T10:30:00Z"},
    ]
    horas = bot.horas_conduccion_estimadas_viaje("c1", "2026-01-01T09:00:00Z", 75)
    # ~55.6 km entre esos dos puntos / 75 km/h
    assert 0.7 < horas < 0.8


def test_horas_conduccion_estimadas_viaje_ignora_pings_de_otro_chofer(fake_db):
    fake_db.tables["ubicacion"] = [
        {"chofer_id": "otro", "lat": 40.0, "lon": -3.0, "created_at": "2026-01-01T10:00:00Z"},
    ]
    horas = bot.horas_conduccion_estimadas_viaje("c1", "2026-01-01T09:00:00Z", 75)
    assert horas == 0.0


# --- resumen_ruta_completada (F14.5) ---

def test_resumen_ruta_completada_sin_desde_iso_no_finge_datos(fake_db):
    r = bot.resumen_ruta_completada("c1", None, 75, paradas=3)
    assert r == {"km": None, "horas": None, "paradas": 3}


def test_resumen_ruta_completada_estima_km_y_horas_desde_los_pings(fake_db):
    fake_db.tables["ubicacion"] = [
        {"chofer_id": "c1", "lat": 40.0, "lon": -3.0, "created_at": "2026-01-01T10:00:00Z"},
        {"chofer_id": "c1", "lat": 40.5, "lon": -3.0, "created_at": "2026-01-01T10:30:00Z"},
    ]
    r = bot.resumen_ruta_completada("c1", "2026-01-01T09:00:00Z", 75, paradas=2)
    assert r["paradas"] == 2
    assert 50 < r["km"] < 60  # ~55.6 km entre esos dos puntos
    assert 0.7 <= r["horas"] < 0.8


# --- handle_location (7A.4): guarda ubicación + pregunta proactiva de llegada ---

def _location_update(lat, lon, edited=False, chat_id="chat-1"):
    loc = SimpleNamespace(latitude=lat, longitude=lon)
    msg = SimpleNamespace(location=loc)
    return SimpleNamespace(
        effective_chat=SimpleNamespace(id=chat_id),
        message=None if edited else msg,
        edited_message=msg if edited else None,
    )


@pytest.mark.asyncio
async def test_handle_location_guarda_ubicacion(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = []
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(40.0, -3.0), ctx)
    assert len(fake_db.tables["ubicacion"]) == 1
    assert fake_db.tables["ubicacion"][0]["chofer_id"] == "c1"


@pytest.mark.asyncio
async def test_handle_location_pregunta_si_cerca_del_hito_pendiente(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"id": "h1", "viaje_id": "v1", "orden": 1, "estado": "pendiente", "lat": 40.0001, "lon": -3.0001, "direccion": "Madrid"},
    ]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(40.0, -3.0), ctx)
    ctx.bot.send_message.assert_awaited_once()
    assert "Madrid" in ctx.bot.send_message.call_args.kwargs["text"]
    assert ctx.chat_data["geo_preguntado"] == "h1"


@pytest.mark.asyncio
async def test_handle_location_no_pregunta_dos_veces(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"id": "h1", "viaje_id": "v1", "orden": 1, "estado": "pendiente", "lat": 40.0001, "lon": -3.0001, "direccion": "Madrid"},
    ]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={"geo_preguntado": "h1"})
    await bot.handle_location(_location_update(40.0, -3.0), ctx)
    ctx.bot.send_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_handle_location_no_pregunta_si_lejos(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"id": "h1", "viaje_id": "v1", "orden": 1, "estado": "pendiente", "lat": 41.0, "lon": -3.0, "direccion": "Madrid"},
    ]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(40.0, -3.0), ctx)
    ctx.bot.send_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_handle_location_no_vinculado_es_silencioso(fake_db):
    fake_db.tables["chofer"] = []
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(40.0, -3.0), ctx)
    ctx.bot.send_message.assert_not_awaited()
    assert fake_db.tables.get("ubicacion", []) == []


@pytest.mark.asyncio
async def test_handle_location_funciona_con_live_location_editada(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = []
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(40.0, -3.0, edited=True), ctx)
    assert len(fake_db.tables["ubicacion"]) == 1


# --- UBI.1: handle_location sub-muestrea la escritura, no la detección ---

@pytest.mark.asyncio
async def test_handle_location_no_reinserta_si_el_ultimo_punto_es_reciente_y_cercano(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = []
    reciente = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    fake_db.tables["ubicacion"] = [{"chofer_id": "c1", "lat": 40.0, "lon": -3.0, "created_at": reciente}]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(40.0001, -3.0001), ctx)
    # No se añade una segunda fila: el punto previo es de hace 5s y casi el mismo sitio.
    assert len(fake_db.tables["ubicacion"]) == 1


@pytest.mark.asyncio
async def test_handle_location_reinserta_si_el_ultimo_punto_es_antiguo(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = []
    fake_db.tables["ubicacion"] = [{"chofer_id": "c1", "lat": 40.0, "lon": -3.0, "created_at": "2020-01-01T10:00:00Z"}]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(40.0, -3.0), ctx)
    assert len(fake_db.tables["ubicacion"]) == 2


@pytest.mark.asyncio
async def test_handle_location_geo_llegada_se_dispara_aunque_no_se_guarde_el_punto(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"id": "h1", "viaje_id": "v1", "orden": 1, "estado": "pendiente", "lat": 40.0001, "lon": -3.0001, "direccion": "Madrid"},
    ]
    reciente = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    fake_db.tables["ubicacion"] = [{"chofer_id": "c1", "lat": 40.0, "lon": -3.0, "created_at": reciente}]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(40.0, -3.0), ctx)
    # El punto no se guarda (reciente y cercano) pero la pregunta proactiva sí se dispara.
    assert len(fake_db.tables["ubicacion"]) == 1
    ctx.bot.send_message.assert_awaited_once()


# --- CHK.4: detección automática de checkpoint en handle_location ---

@pytest.mark.asyncio
async def test_handle_location_registra_checkpoint_pasado_al_entrar_en_el_radio(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"id": "cp1", "viaje_id": "v1", "orden": 1, "estado": "completado", "lat": 43.0, "lon": -1.8,
         "direccion": "Aduana Irún", "es_checkpoint": True, "radio_m": 200},
        {"id": "h2", "viaje_id": "v1", "orden": 2, "estado": "pendiente", "lat": 41.0, "lon": 2.0, "direccion": "Barcelona"},
    ]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(43.0, -1.8), ctx)
    eventos = [e for e in fake_db.tables["ejecucion_evento"] if e["tipo"] == "checkpoint_pasado"]
    assert len(eventos) == 1
    assert eventos[0]["hito_id"] == "cp1"
    assert eventos[0]["viaje_id"] == "v1"


@pytest.mark.asyncio
async def test_handle_location_no_registra_checkpoint_dos_veces(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"id": "cp1", "viaje_id": "v1", "orden": 1, "estado": "completado", "lat": 43.0, "lon": -1.8,
         "direccion": "Aduana Irún", "es_checkpoint": True, "radio_m": 200},
    ]
    fake_db.tables["ejecucion_evento"] = [
        {"id": "ev1", "viaje_id": "v1", "hito_id": "cp1", "chofer_id": "c1", "tipo": "checkpoint_pasado"},
    ]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(43.0, -1.8), ctx)
    eventos = [e for e in fake_db.tables["ejecucion_evento"] if e["tipo"] == "checkpoint_pasado"]
    assert len(eventos) == 1  # sigue siendo 1, no se duplica


@pytest.mark.asyncio
async def test_handle_location_hito_normal_no_genera_evento_checkpoint(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = [
        {"id": "h1", "viaje_id": "v1", "orden": 1, "estado": "pendiente", "lat": 43.0, "lon": -1.8,
         "direccion": "Madrid", "es_checkpoint": False},
    ]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(43.0, -1.8), ctx)
    eventos = [e for e in fake_db.tables.get("ejecucion_evento", []) if e["tipo"] == "checkpoint_pasado"]
    assert len(eventos) == 0


# --- F13.5: aviso proactivo de pausa 561 en handle_location ---

@pytest.mark.asyncio
async def test_handle_location_avisa_pausa_561_al_superar_el_umbral(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = []
    fake_db.tables["empresa"] = [{"id": "e1", "velocidad_planificacion_kmh": 75}]
    fake_db.tables["ejecucion_evento"] = [
        {"viaje_id": "v1", "hito_id": None, "tipo": "llegada", "ocurrido_en": "2026-01-01T09:00:00Z"},
    ]
    # ~344 km entre estos dos puntos (3.1 grados de latitud) / 75 km/h ~ 4.6h > 4.5h
    fake_db.tables["ubicacion"] = [
        {"chofer_id": "c1", "lat": 40.0, "lon": -3.0, "created_at": "2026-01-01T09:30:00Z"},
        {"chofer_id": "c1", "lat": 43.1, "lon": -3.0, "created_at": "2026-01-01T13:00:00Z"},
    ]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(43.1, -3.0), ctx)
    ctx.bot.send_message.assert_awaited_once()
    assert "45 min" in ctx.bot.send_message.call_args.kwargs["text"]
    assert ctx.chat_data["aviso_pausa_561_viaje"] == "v1"


@pytest.mark.asyncio
async def test_handle_location_no_avisa_pausa_561_dos_veces(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = []
    fake_db.tables["empresa"] = [{"id": "e1", "velocidad_planificacion_kmh": 75}]
    fake_db.tables["ejecucion_evento"] = [
        {"viaje_id": "v1", "hito_id": None, "tipo": "llegada", "ocurrido_en": "2026-01-01T09:00:00Z"},
    ]
    fake_db.tables["ubicacion"] = [
        {"chofer_id": "c1", "lat": 40.0, "lon": -3.0, "created_at": "2026-01-01T09:30:00Z"},
        {"chofer_id": "c1", "lat": 43.1, "lon": -3.0, "created_at": "2026-01-01T13:00:00Z"},
    ]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={"aviso_pausa_561_viaje": "v1"})
    await bot.handle_location(_location_update(43.1, -3.0), ctx)
    ctx.bot.send_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_handle_location_no_avisa_pausa_561_por_debajo_del_umbral(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "es", "chat_id": "chat-1", "empresa_id": "e1"}]
    fake_db.tables["viaje"] = [{"id": "v1", "chofer_id": "c1", "estado": "en_curso"}]
    fake_db.tables["hito"] = []
    fake_db.tables["empresa"] = [{"id": "e1", "velocidad_planificacion_kmh": 75}]
    fake_db.tables["ejecucion_evento"] = [
        {"viaje_id": "v1", "hito_id": None, "tipo": "llegada", "ocurrido_en": "2026-01-01T09:00:00Z"},
    ]
    fake_db.tables["ubicacion"] = [
        {"chofer_id": "c1", "lat": 40.0, "lon": -3.0, "created_at": "2026-01-01T09:30:00Z"},
    ]
    ctx = SimpleNamespace(bot=AsyncMock(), chat_data={})
    await bot.handle_location(_location_update(40.0, -3.0), ctx)
    ctx.bot.send_message.assert_not_awaited()


# --- ejecutar_con_reintentos + manejar_error (8.2): "el canal con el chófer
# nunca se cae en silencio" ---

import httpx  # noqa: E402


@pytest.fixture(autouse=True)
def _sin_esperas_reales(monkeypatch):
    """Los tests de reintentos no deben esperar de verdad los 0.5s/1s de backoff."""
    monkeypatch.setattr(bot.time, "sleep", lambda _: None)


def test_ejecutar_con_reintentos_exito_al_segundo_intento():
    llamadas = {"n": 0}

    def fn():
        llamadas["n"] += 1
        if llamadas["n"] < 2:
            raise httpx.ConnectError("blip de red")
        return "ok"

    resultado = bot.ejecutar_con_reintentos(fn)
    assert resultado == "ok"
    assert llamadas["n"] == 2


def test_ejecutar_con_reintentos_falla_tras_agotar_intentos():
    def fn():
        raise httpx.TimeoutException("timeout")

    with pytest.raises(httpx.TimeoutException):
        bot.ejecutar_con_reintentos(fn, intentos=3)


def test_ejecutar_con_reintentos_no_reintenta_errores_de_logica():
    """Un ValueError (bug/validación) no se arregla reintentando — debe
    propagarse inmediatamente, sin backoff."""
    llamadas = {"n": 0}

    def fn():
        llamadas["n"] += 1
        raise ValueError("dato inválido")

    with pytest.raises(ValueError):
        bot.ejecutar_con_reintentos(fn)
    assert llamadas["n"] == 1


@pytest.mark.asyncio
async def test_manejar_error_avisa_al_chofer_en_su_idioma(fake_db):
    from datetime import datetime, timezone
    from telegram import Chat, Message, Update

    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "idioma": "en", "chat_id": "555", "empresa_id": "e1"}]
    chat = Chat(id=555, type="private")
    message = Message(message_id=1, date=datetime.now(timezone.utc), chat=chat)
    update = Update(update_id=123, message=message)

    ctx = SimpleNamespace(bot=AsyncMock(), error=RuntimeError("boom"))
    await bot.manejar_error(update, ctx)

    ctx.bot.send_message.assert_awaited_once()
    assert ctx.bot.send_message.call_args.kwargs["chat_id"] == 555
    assert "technical problem" in ctx.bot.send_message.call_args.kwargs["text"]


@pytest.mark.asyncio
async def test_manejar_error_no_lanza_si_no_hay_chat_identificable():
    ctx = SimpleNamespace(bot=AsyncMock(), error=RuntimeError("boom"))
    await bot.manejar_error(None, ctx)
    ctx.bot.send_message.assert_not_awaited()


# --- heartbeat (8.3): "el canal con el chófer nunca se cae en silencio" ---

@pytest.mark.asyncio
async def test_heartbeat_inserta_una_fila(fake_db):
    fake_db.tables["bot_heartbeat"] = []
    await bot.heartbeat(SimpleNamespace())
    assert len(fake_db.tables["bot_heartbeat"]) == 1


@pytest.mark.asyncio
async def test_heartbeat_no_lanza_si_falla_la_insercion(monkeypatch):
    class SupabaseRoto:
        def table(self, _name):
            raise ConnectionError("sin red")

    monkeypatch.setattr(bot, "supabase", SupabaseRoto())
    await bot.heartbeat(SimpleNamespace())  # no debe lanzar
