"""Tests de los SLOs internos (ítem 9.19). Grupo A: lógica en memoria con un
cursor fake (nunca toca Postgres real) — verifica el cálculo de disponibilidad
a partir de huecos entre latidos, y el % de asignaciones notificadas a
tiempo a partir de deltas ya calculados.
"""
from datetime import datetime, timedelta, timezone

from db.calcular_slos import (
    OBJETIVO_NOTIFICACION_S,
    UMBRAL_HEARTBEAT_S,
    slo_disponibilidad_bot,
    slo_notificacion_asignacion,
)


class FakeCursor:
    def __init__(self, filas):
        self._filas = filas

    def execute(self, _query, _params=None):
        pass

    def fetchall(self):
        return self._filas


def _t(segundos_desde_inicio):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return base + timedelta(seconds=segundos_desde_inicio)


class TestSloDisponibilidadBot:
    def test_latidos_regulares_dan_disponibilidad_100(self):
        # Latidos cada 120s (el intervalo real del bot), todos por debajo del umbral.
        filas = [(_t(i * 120),) for i in range(10)]
        r = slo_disponibilidad_bot(FakeCursor(filas), horas=24)
        assert r["latidos"] == 10
        assert r["disponibilidad_pct"] == 100.0

    def test_un_hueco_por_encima_del_umbral_reduce_la_disponibilidad(self):
        # Dos latidos normales, luego un hueco de 600s (el doble del umbral de 300s).
        filas = [(_t(0),), (_t(120),), (_t(120 + 600),)]
        r = slo_disponibilidad_bot(FakeCursor(filas), horas=24)
        # ventana total = 720s; tiempo "sin señal" = 600 - 300 = 300s
        ventana_total = 720
        tiempo_sin_senal = 600 - UMBRAL_HEARTBEAT_S
        esperado = round((1 - tiempo_sin_senal / ventana_total) * 100, 2)
        assert r["disponibilidad_pct"] == esperado
        assert r["hueco_maximo_s"] == 600.0

    def test_menos_de_dos_latidos_no_da_porcentaje(self):
        r = slo_disponibilidad_bot(FakeCursor([(_t(0),)]), horas=24)
        assert r["latidos"] == 1
        assert r["disponibilidad_pct"] is None

        r0 = slo_disponibilidad_bot(FakeCursor([]), horas=24)
        assert r0["latidos"] == 0
        assert r0["disponibilidad_pct"] is None


class TestSloNotificacionAsignacion:
    def test_todas_dentro_del_objetivo_dan_100_por_ciento(self):
        filas = [(10.0,), (30.0,), (59.9,)]
        r = slo_notificacion_asignacion(FakeCursor(filas), horas=24)
        assert r["asignaciones"] == 3
        assert r["pct_dentro_objetivo"] == 100.0

    def test_algunas_fuera_del_objetivo_reducen_el_porcentaje(self):
        filas = [(10.0,), (90.0,), (30.0,), (200.0,)]  # 2 de 4 por encima de 60s
        r = slo_notificacion_asignacion(FakeCursor(filas), horas=24)
        assert r["asignaciones"] == 4
        assert r["pct_dentro_objetivo"] == 50.0

    def test_sin_asignaciones_no_da_porcentaje(self):
        r = slo_notificacion_asignacion(FakeCursor([]), horas=24)
        assert r["asignaciones"] == 0
        assert r["pct_dentro_objetivo"] is None

    def test_p95_se_calcula_sobre_los_deltas_ordenados(self):
        filas = [(float(i),) for i in range(1, 21)]  # 1..20
        r = slo_notificacion_asignacion(FakeCursor(filas), horas=24)
        assert r["asignaciones"] == 20
        # índice 0.95*20=19 (0-indexado) -> el valor 20.0
        assert r["p95_s"] == 20.0


def test_objetivo_de_notificacion_es_60s_como_dice_el_roadmap():
    assert OBJETIVO_NOTIFICACION_S == 60
