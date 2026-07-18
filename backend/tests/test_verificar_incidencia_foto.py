"""Tests del hash de integridad de la foto de incidencia (F14.6, 0057_incidencia_foto.sql).

Igual criterio que test_verificar_pod.py: prueba la LÓGICA de verificación en
memoria con un cliente Storage fake (nunca toca Storage real).
"""
from db.verificar_pod import calcular_hash_sha256
from db.verificar_incidencia_foto import verificar_hash_incidencia


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


def test_verificar_hash_incidencia_ok_cuando_coincide():
    contenido = b"foto-original-de-la-incidencia"
    incidencia = {
        "id": "inc-1",
        "foto_url": "empresa/incidencia/x/y.jpg",
        "foto_hash_sha256": calcular_hash_sha256(contenido),
    }
    sb = FakeSupabaseStorage({incidencia["foto_url"]: contenido})

    resultado = verificar_hash_incidencia(sb, incidencia)
    assert resultado == {"incidencia_id": "inc-1", "ok": True, "motivo": None}


def test_verificar_hash_incidencia_detecta_fichero_sustituido():
    """El caso estrella: alguien reemplazó el fichero en Storage después de subirlo."""
    original = b"foto-original-de-la-incidencia"
    sustituido = b"foto-manipulada-distinta"
    incidencia = {
        "id": "inc-2",
        "foto_url": "empresa/incidencia/x/y.jpg",
        "foto_hash_sha256": calcular_hash_sha256(original),
    }
    sb = FakeSupabaseStorage({incidencia["foto_url"]: sustituido})

    resultado = verificar_hash_incidencia(sb, incidencia)
    assert resultado["ok"] is False
    assert resultado["motivo"] == "hash_no_coincide"
    assert resultado["incidencia_id"] == "inc-2"


def test_verificar_hash_incidencia_detecta_fichero_ausente():
    incidencia = {"id": "inc-3", "foto_url": "empresa/incidencia/x/no-existe.jpg", "foto_hash_sha256": "abc123"}
    sb = FakeSupabaseStorage({incidencia["foto_url"]: FileNotFoundError("objeto no encontrado")})

    resultado = verificar_hash_incidencia(sb, incidencia)
    assert resultado["ok"] is False
    assert resultado["motivo"].startswith("archivo_no_encontrado")
