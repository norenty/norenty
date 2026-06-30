"""Tests del bot: lo crítico es que un chófer no pueda tocar hitos de otro
viaje (vulnerabilidad real que se corrigió en la auditoría de seguridad),
y que el flujo de mensajes/navegación se construya bien.
"""
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
