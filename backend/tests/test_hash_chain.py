"""Tests del hash-chain de ejecucion_evento (ítem 9.7, ver SPECS-9.md §5).

Grupo A (este archivo): prueba la LÓGICA de recomputo/verificación en memoria,
con un cursor fake que nunca toca Postgres. NO prueba el trigger real (eso
requeriría un motor SQL de verdad — ver SPECS-9.md §5, Grupo B, verificado a
mano contra la BD real y documentado en PROGRESS.md). Lo que SÍ prueba aquí:
que el algoritmo espejo (`_calc_hash`) es correcto y que `verificar_cadena`
detecta encadenados válidos y roturas.
"""
from datetime import datetime, timezone
from uuid import UUID

from db.verificar_cadena import _calc_hash, verificar_cadena

VIAJE_A = UUID("22222222-2222-2222-2222-222222222222")
VIAJE_B = UUID("33333333-3333-3333-3333-333333333333")


class FakeCursor:
    """Imita cur.execute()/cur.fetchall() de psycopg2 (RealDictCursor): las
    filas ya vienen en el orden canónico (viaje_id, ocurrido_en, registrado_en,
    id) que produciría la query real — construirlas así es responsabilidad del
    test, igual que el ORDER BY es responsabilidad de la query real.
    """
    def __init__(self, filas):
        self._filas = filas

    def execute(self, _query, _params=None):
        pass

    def fetchall(self):
        return self._filas


def crear_evento(id_, viaje_id, hash_prev, ocurrido_en, tipo="llegada", detalle="Calle Falsa 123",
                  hito_id=None, chofer_id=None):
    """Construye una fila válida (hash calculado de verdad, como lo haría el trigger)."""
    h = _calc_hash(hash_prev, id_, viaje_id, hito_id, chofer_id, tipo, detalle, ocurrido_en)
    return {
        "id": id_, "viaje_id": viaje_id, "hito_id": hito_id, "chofer_id": chofer_id,
        "tipo": tipo, "detalle": detalle, "ocurrido_en": ocurrido_en,
        "hash": h, "hash_prev": hash_prev,
    }


def test_calc_hash_primer_evento_coincide_con_valor_conocido():
    """(a) — hash hardcodeado calculado una vez con el mismo algoritmo (ver
    SPECS-9.md §5, nota de fixtures deterministas). Si cambia el orden de
    campos o el formato del timestamp, este test debe romper."""
    h = _calc_hash(
        None,
        UUID("11111111-1111-1111-1111-111111111111"),
        VIAJE_A,
        None, None,
        "llegada", "Calle Falsa 123",
        datetime(2026, 1, 1, 10, 0, 0, 123456, tzinfo=timezone.utc),
    )
    assert h == "53b8d15472695588c7d5350287ff99495b88ad5627ee4e723ea91316e9315c82"


def test_inserciones_seguidas_mismo_viaje_encadenan_en_orden():
    """(b) — evento2.hash_prev == evento1.hash; verificación ok."""
    e1 = crear_evento(UUID(int=1), VIAJE_A, None, datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc))
    e2 = crear_evento(UUID(int=2), VIAJE_A, e1["hash"], datetime(2026, 1, 1, 11, 0, tzinfo=timezone.utc), tipo="salida")

    resultado = verificar_cadena(FakeCursor([e1, e2]))
    assert resultado["ok"] is True
    assert resultado["eventos_verificados"] == 2
    assert resultado["cadenas"] == 1
    assert e2["hash_prev"] == e1["hash"]


def test_viajes_distintos_son_cadenas_independientes():
    """(c) — cada viaje es raíz de su propia cadena (hash_prev IS NULL para ambos)."""
    ea = crear_evento(UUID(int=1), VIAJE_A, None, datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc))
    eb = crear_evento(UUID(int=2), VIAJE_B, None, datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc))

    resultado = verificar_cadena(FakeCursor([ea, eb]))
    assert resultado["ok"] is True
    assert resultado["cadenas"] == 2
    assert ea["hash_prev"] is None
    assert eb["hash_prev"] is None


def test_alterar_ocurrido_en_de_un_evento_historico_se_detecta():
    """(d) — el caso estrella: mutar un campo inmutable por SQL directo (salta
    el trigger porque es UPDATE, no INSERT) rompe la verificación en ESE evento."""
    e1 = crear_evento(UUID(int=1), VIAJE_A, None, datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc))
    e2 = crear_evento(UUID(int=2), VIAJE_A, e1["hash"], datetime(2026, 1, 1, 11, 0, tzinfo=timezone.utc), tipo="salida")

    # Alteración a mano de un evento histórico, sin recalcular su hash (como
    # haría un UPDATE directo sobre la BD real, que el trigger BEFORE INSERT no cubre).
    e1["ocurrido_en"] = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)

    resultado = verificar_cadena(FakeCursor([e1, e2]))
    assert resultado["ok"] is False
    assert resultado["rotura"]["evento_id"] == str(e1["id"])
    assert resultado["rotura"]["motivo"] == "hash_no_coincide"


def test_borrar_evento_intermedio_se_detecta():
    """(e) — cadena de 3, se borra el intermedio: el tercero queda con un
    hash_prev que ya no coincide con el (nuevo) anterior real."""
    e1 = crear_evento(UUID(int=1), VIAJE_A, None, datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc))
    e2 = crear_evento(UUID(int=2), VIAJE_A, e1["hash"], datetime(2026, 1, 1, 11, 0, tzinfo=timezone.utc), tipo="salida")
    e3 = crear_evento(UUID(int=3), VIAJE_A, e2["hash"], datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc), tipo="pod_subido")

    resultado = verificar_cadena(FakeCursor([e1, e3]))  # e2 "borrado"
    assert resultado["ok"] is False
    assert resultado["rotura"]["evento_id"] == str(e3["id"])
    assert resultado["rotura"]["motivo"] == "hash_prev_roto"


def test_primer_evento_con_hash_prev_relleno_se_detecta():
    """Caso adicional: si el primer evento de una cadena viniera con hash_prev
    no nulo (nunca debería pasar con el trigger real), también se detecta."""
    e1 = crear_evento(UUID(int=1), VIAJE_A, "no-deberia-estar-aqui", datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc))

    resultado = verificar_cadena(FakeCursor([e1]))
    assert resultado["ok"] is False
    assert resultado["rotura"]["motivo"] == "primer_evento_con_hash_prev"


def test_cadena_vacia_es_valida():
    resultado = verificar_cadena(FakeCursor([]))
    assert resultado["ok"] is True
    assert resultado["eventos_verificados"] == 0
    assert resultado["cadenas"] == 0
