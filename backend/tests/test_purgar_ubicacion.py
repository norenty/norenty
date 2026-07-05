"""Tests del job de purga de ubicacion (ítem 9.13). Grupo A: lógica en memoria
con un cursor fake (nunca toca Postgres real) — verifica que cuenta antes de
borrar, que respeta dry-run, que no ejecuta DELETE si no hay nada que purgar,
y que el umbral de días se pasa como parámetro (no interpolado en el SQL).
"""
from db.purgar_ubicacion import contar_filas_a_purgar, purgar_ubicacion


class FakeCursor:
    def __init__(self, filas_viejas, rowcount_delete=None):
        self._filas_viejas = filas_viejas
        self.rowcount = rowcount_delete if rowcount_delete is not None else filas_viejas
        self.queries = []

    def execute(self, query, params=None):
        self.queries.append((query, params))

    def fetchone(self):
        return (self._filas_viejas,)


def test_contar_filas_a_purgar_usa_el_umbral_como_parametro():
    cur = FakeCursor(filas_viejas=7)
    total = contar_filas_a_purgar(cur, dias=90)
    assert total == 7
    query, params = cur.queries[0]
    assert "select" in query.lower()
    assert params == (90,)


def test_dry_run_no_ejecuta_delete():
    cur = FakeCursor(filas_viejas=5)
    resultado = purgar_ubicacion(cur, dias=90, dry_run=True)
    assert resultado == 5
    assert len(cur.queries) == 1  # solo el count
    assert "delete" not in cur.queries[0][0].lower()


def test_purga_real_ejecuta_delete_tras_contar():
    cur = FakeCursor(filas_viejas=3, rowcount_delete=3)
    resultado = purgar_ubicacion(cur, dias=90, dry_run=False)
    assert resultado == 3
    assert len(cur.queries) == 2
    assert "select" in cur.queries[0][0].lower()
    assert "delete" in cur.queries[1][0].lower()


def test_sin_filas_que_purgar_no_ejecuta_delete_innecesario():
    cur = FakeCursor(filas_viejas=0)
    resultado = purgar_ubicacion(cur, dias=90, dry_run=False)
    assert resultado == 0
    assert len(cur.queries) == 1  # el DELETE ni se intenta


def test_umbral_de_dias_personalizado_se_propaga_al_delete():
    cur = FakeCursor(filas_viejas=2, rowcount_delete=2)
    purgar_ubicacion(cur, dias=60, dry_run=False)
    _, params_delete = cur.queries[1]
    assert params_delete == (60,)
