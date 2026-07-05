"""Tests del hash de integridad de POD (ítem 9.8, ver ROADMAP Fase 9 Bloque C).

Igual criterio que test_hash_chain.py: prueba la LÓGICA de verificación en
memoria con un cliente Storage fake (nunca toca Storage real). El hecho de
que el bot calcula bien el hash al subir la foto ya está probado en
test_bot_e2e.py (recorre el handler real con la BD/Storage fake).
"""
from db.verificar_pod import calcular_hash_sha256, verificar_hash_pod


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


def test_calcular_hash_sha256_es_determinista():
    assert calcular_hash_sha256(b"contenido-real-del-pod") == calcular_hash_sha256(b"contenido-real-del-pod")
    assert calcular_hash_sha256(b"contenido-real-del-pod") != calcular_hash_sha256(b"otro-contenido")


def test_verificar_hash_pod_ok_cuando_coincide():
    contenido = b"foto-original-del-albaran"
    pod = {"id": "pod-1", "foto_url": "empresa/viaje/hito/x.jpg", "hash_sha256": calcular_hash_sha256(contenido)}
    sb = FakeSupabaseStorage({pod["foto_url"]: contenido})

    resultado = verificar_hash_pod(sb, pod)
    assert resultado == {"pod_id": "pod-1", "ok": True, "motivo": None}


def test_verificar_hash_pod_detecta_fichero_sustituido():
    """El caso estrella: alguien reemplazó el fichero en Storage después de subirlo."""
    original = b"foto-original-del-albaran"
    sustituido = b"foto-manipulada-distinta"
    pod = {"id": "pod-2", "foto_url": "empresa/viaje/hito/x.jpg", "hash_sha256": calcular_hash_sha256(original)}
    sb = FakeSupabaseStorage({pod["foto_url"]: sustituido})

    resultado = verificar_hash_pod(sb, pod)
    assert resultado["ok"] is False
    assert resultado["motivo"] == "hash_no_coincide"
    assert resultado["pod_id"] == "pod-2"


def test_verificar_hash_pod_detecta_fichero_ausente():
    pod = {"id": "pod-3", "foto_url": "empresa/viaje/hito/no-existe.jpg", "hash_sha256": "abc123"}
    sb = FakeSupabaseStorage({pod["foto_url"]: FileNotFoundError("objeto no encontrado")})

    resultado = verificar_hash_pod(sb, pod)
    assert resultado["ok"] is False
    assert resultado["motivo"].startswith("archivo_no_encontrado")
