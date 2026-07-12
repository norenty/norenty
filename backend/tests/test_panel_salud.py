"""Tests de la pantalla de salud del sistema (ítem 10.7). Grupo A: agregación
pura sobre las señales ya existentes (heartbeat, SLOs 9.19, integridad 10.6),
con las funciones reutilizadas mockeadas via monkeypatch (cada una ya tiene
sus propios tests dedicados; aquí solo se prueba que panel_salud las junta
correctamente)."""
from db.panel_salud import generar_panel


class FakeCursorPanel:
    def __init__(self, integridad_filas=None, alertas_bot_filas=None):
        self.integridad_filas = integridad_filas or []
        self.alertas_bot_filas = alertas_bot_filas or []
        self._ultimo = None

    def execute(self, query, params=None):
        q = query.strip()
        if q.startswith("SELECT tipo, entidad_id, motivo, detectada_en FROM alerta_integridad"):
            self._ultimo = "integridad"
        elif q.startswith("SELECT enviada_en, resuelta_en FROM alerta_bot_caido"):
            self._ultimo = "alertas_bot"
        else:
            raise AssertionError(f"query no esperada: {query}")

    def fetchall(self):
        if self._ultimo == "integridad":
            return self.integridad_filas
        if self._ultimo == "alertas_bot":
            return self.alertas_bot_filas
        return []


def _mockear_dependencias(monkeypatch, heartbeat=(False, 30), slo1=None, slo2=None):
    monkeypatch.setattr("db.panel_salud.obtener_estado_heartbeat", lambda cur: heartbeat)
    monkeypatch.setattr(
        "db.panel_salud.slo_disponibilidad_bot",
        lambda cur, horas: slo1 or {"latidos": 10, "disponibilidad_pct": 99.5, "hueco_maximo_s": 120.0},
    )
    monkeypatch.setattr(
        "db.panel_salud.slo_notificacion_asignacion",
        lambda cur, horas: slo2 or {"asignaciones": 5, "pct_dentro_objetivo": 100.0, "p95_s": 45.0},
    )


def test_panel_junta_heartbeat_slos_e_integridad(monkeypatch):
    _mockear_dependencias(monkeypatch, heartbeat=(False, 30))
    cur = FakeCursorPanel(
        integridad_filas=[("pod", "p1", "hash_no_coincide", "2026-07-12")],
        alertas_bot_filas=[("2026-07-10", "2026-07-10")],
    )
    p = generar_panel(cur, horas=24)
    assert p["heartbeat"]["caido"] is False
    assert p["slo_disponibilidad"]["disponibilidad_pct"] == 99.5
    assert p["slo_notificacion"]["pct_dentro_objetivo"] == 100.0
    assert len(p["integridad_reciente"]) == 1
    assert p["integridad_reciente"][0]["entidad_id"] == "p1"
    assert len(p["alertas_bot_recientes"]) == 1
    assert p["horas"] == 24


def test_panel_sin_ninguna_alerta_reciente(monkeypatch):
    _mockear_dependencias(monkeypatch, heartbeat=(True, None))
    cur = FakeCursorPanel(integridad_filas=[], alertas_bot_filas=[])
    p = generar_panel(cur, horas=24)
    assert p["heartbeat"]["caido"] is True
    assert p["integridad_reciente"] == []
    assert p["alertas_bot_recientes"] == []


def test_panel_sin_datos_de_slo_no_lanza(monkeypatch):
    _mockear_dependencias(
        monkeypatch,
        slo1={"latidos": 0, "disponibilidad_pct": None, "hueco_maximo_s": None},
        slo2={"asignaciones": 0, "pct_dentro_objetivo": None, "p95_s": None},
    )
    cur = FakeCursorPanel()
    p = generar_panel(cur, horas=24)
    assert p["slo_disponibilidad"]["disponibilidad_pct"] is None
    assert p["slo_notificacion"]["pct_dentro_objetivo"] is None
