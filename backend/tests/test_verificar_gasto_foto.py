"""Tests del hash de integridad de la foto de gasto (12.1, 0043_gasto_foto.sql).

Igual criterio que test_verificar_pod.py / test_verificar_incidencia_foto.py:
prueba la LÓGICA de verificación en memoria con un cliente Storage fake (nunca
toca Storage real).
"""
from db.verificar_pod import calcular_hash_sha256
from db.verificar_gasto_foto import verificar_hash_gasto


class FakeBucket:
    def __init__(self, contenidos):
        self._contenidos = contenidos  # path -> bytes | Exception

    def download(self, path):
        valor = self._contenidos.get(path)
        if isinstance(valor, Exception):
            raise valor
        return valor


class FakeStorageCliente:
    def __init__(self, contenidos):
        self._bucket = FakeBucket(contenidos)

    def from_(self, _bucket_name):
        return self._bucket


class FakeSupabaseStorage:
    def __init__(self, contenidos):
        self.storage = FakeStorageCliente(contenidos)


def test_verificar_hash_gasto_ok_cuando_coincide():
    contenido = b"foto-original-del-ticket-de-gasolina"
    gasto = {
        "id": "gasto-1",
        "foto_url": "empresa/gasto/viaje/x.jpg",
        "foto_hash_sha256": calcular_hash_sha256(contenido),
    }
    sb = FakeSupabaseStorage({gasto["foto_url"]: contenido})

    resultado = verificar_hash_gasto(sb, gasto)
    assert resultado == {"gasto_id": "gasto-1", "ok": True, "motivo": None}


def test_verificar_hash_gasto_detecta_fichero_sustituido():
    """El caso estrella: alguien reemplazó el fichero en Storage después de subirlo."""
    original = b"foto-original-del-ticket-de-gasolina"
    sustituido = b"foto-manipulada-distinta"
    gasto = {
        "id": "gasto-2",
        "foto_url": "empresa/gasto/viaje/x.jpg",
        "foto_hash_sha256": calcular_hash_sha256(original),
    }
    sb = FakeSupabaseStorage({gasto["foto_url"]: sustituido})

    resultado = verificar_hash_gasto(sb, gasto)
    assert resultado["ok"] is False
    assert resultado["motivo"] == "hash_no_coincide"
    assert resultado["gasto_id"] == "gasto-2"


def test_verificar_hash_gasto_detecta_fichero_ausente():
    gasto = {"id": "gasto-3", "foto_url": "empresa/gasto/viaje/no-existe.jpg", "foto_hash_sha256": "abc123"}
    sb = FakeSupabaseStorage({gasto["foto_url"]: FileNotFoundError("objeto no encontrado")})

    resultado = verificar_hash_gasto(sb, gasto)
    assert resultado["ok"] is False
    assert resultado["motivo"].startswith("archivo_no_encontrado")
