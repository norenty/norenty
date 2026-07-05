"""Tests del logging estructurado en JSON (ítem 9.5): cada línea debe ser un
JSON válido con los campos de contexto reales (empresa_id/viaje_id/chofer_id/
update_id/...) pasados por `extra=`, para poder responder en minutos a
"ayer a las 18:40 no me llegó la alerta" sin parsear texto libre.
"""
import json
import logging

from app.bot import JsonFormatter


def _formatear(record):
    return json.loads(JsonFormatter().format(record))


def _crear_record(level=logging.INFO, msg="mensaje", extra=None, exc_info=None):
    record = logging.LogRecord(
        name="norenty.bot", level=level, pathname=__file__, lineno=1,
        msg=msg, args=(), exc_info=exc_info,
    )
    for k, v in (extra or {}).items():
        setattr(record, k, v)
    return record


def test_formatea_como_json_valido_con_campos_base():
    salida = _formatear(_crear_record(msg="hola"))
    assert salida["level"] == "INFO"
    assert salida["logger"] == "norenty.bot"
    assert salida["message"] == "hola"
    assert "timestamp" in salida


def test_incluye_los_campos_de_extra_tal_cual():
    salida = _formatear(_crear_record(extra={"empresa_id": "e1", "viaje_id": "v1", "chofer_id": "c1"}))
    assert salida["empresa_id"] == "e1"
    assert salida["viaje_id"] == "v1"
    assert salida["chofer_id"] == "c1"


def test_no_incluye_extra_si_no_se_paso_ninguno():
    salida = _formatear(_crear_record())
    assert "empresa_id" not in salida
    assert "viaje_id" not in salida


def test_incluye_la_excepcion_si_hay_exc_info():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys
        record = _crear_record(level=logging.ERROR, msg="fallo", exc_info=sys.exc_info())
    salida = _formatear(record)
    assert "ValueError: boom" in salida["exception"]


def test_nunca_revienta_con_un_valor_no_serializable_en_extra():
    class NoSerializable:
        def __str__(self):
            return "objeto-raro"

    salida = _formatear(_crear_record(extra={"algo": NoSerializable()}))
    assert salida["algo"] == "objeto-raro"
