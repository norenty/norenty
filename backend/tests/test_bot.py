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
    textos = [b.text for b in teclado.keyboard[0]]
    assert "📍 Reportar incidencia" in textos
    assert "📋 Mi viaje" in textos
    assert "📞 Contactar gestor" in textos


@pytest.mark.asyncio
async def test_handle_menu_texto_boton_incidencia_muestra_ayuda(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    update = fake_menu_update("📍 Reportar incidencia")
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.handle_menu_texto(update, ctx)
    texto = update.message.reply_text.call_args[0][0]
    assert "/incidencia" in texto


@pytest.mark.asyncio
async def test_handle_menu_texto_boton_mi_viaje_llama_send_next_hito(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    update = fake_menu_update("📋 Mi viaje")
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.handle_menu_texto(update, ctx)
    ctx.bot.send_message.assert_awaited_once()
    assert "No tienes ningún viaje activo" in ctx.bot.send_message.call_args.kwargs["text"]


@pytest.mark.asyncio
async def test_handle_menu_texto_boton_contactar_con_gestor(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "nombre": "Ana", "email": "ana@norenty.com"}]
    update = fake_menu_update("📞 Contactar gestor")
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.handle_menu_texto(update, ctx)
    texto = update.message.reply_text.call_args[0][0]
    assert "Ana" in texto
    assert "ana@norenty.com" in texto


@pytest.mark.asyncio
async def test_handle_menu_texto_boton_contactar_sin_gestor(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    fake_db.tables["gestor"] = []
    update = fake_menu_update("📞 Contactar gestor")
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.handle_menu_texto(update, ctx)
    texto = update.message.reply_text.call_args[0][0]
    assert "aún no ha configurado contacto" in texto


@pytest.mark.asyncio
async def test_handle_menu_texto_chofer_no_vinculado_no_responde(fake_db):
    fake_db.tables["chofer"] = []
    update = fake_menu_update("📋 Mi viaje")
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.handle_menu_texto(update, ctx)
    update.message.reply_text.assert_not_called()
    ctx.bot.send_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_handle_menu_texto_texto_desconocido_no_responde(fake_db):
    fake_db.tables["chofer"] = [{"id": "c1", "nombre": "Mario", "empresa_id": "e1", "chat_id": "chat-1", "idioma": "es"}]
    update = fake_menu_update("hola, todo bien")
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.handle_menu_texto(update, ctx)
    update.message.reply_text.assert_not_called()


# --- Transporte: abstracción de mensajería al gestor (Fase 4.6) ---

@pytest.mark.asyncio
async def test_alertar_gestor_crea_incidencia_y_usa_el_transporte(fake_db, fake_transporte):
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-1"}]
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
    fake_db.tables["gestor"] = [{"id": "g1", "empresa_id": "e1", "telegram_chat_id": None}]
    fake_db.tables["viaje"] = [{"id": "v1", "referencia": "VJ-1"}]

    await bot.alertar_gestor("e1", "v1", "otro", "texto")

    assert fake_transporte.enviados == []


@pytest.mark.asyncio
async def test_notificar_gestor_evento_usa_el_transporte(fake_db, fake_transporte):
    fake_db.tables["gestor"] = [
        {"id": "g1", "empresa_id": "e1", "telegram_chat_id": "chat-1"},
        {"id": "g2", "empresa_id": "e1", "telegram_chat_id": "chat-2"},
    ]

    await bot.notificar_gestor_evento("e1", "v1", "Mensaje de prueba")

    assert fake_transporte.enviados == [("chat-1", "Mensaje de prueba"), ("chat-2", "Mensaje de prueba")]


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
    fake_db.tables["gestor"] = [{"empresa_id": "e1", "telegram_chat_id": "gestor-chat"}]
    ctx = SimpleNamespace(bot=AsyncMock())
    await bot.procesar_notificaciones_asignacion(ctx)

    ctx.bot.send_message.assert_not_awaited()
    assert fake_db.tables["viaje"][0]["notificado_asignacion_en"] is not None
    assert len(fake_transporte.enviados) == 1
    assert "Mario" in fake_transporte.enviados[0][1]


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
