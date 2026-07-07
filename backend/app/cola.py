"""Cola de trabajos asíncrona sobre Postgres (ítem 9.18, spec en SPECS-9.md
"Bloque colas").

Reintentos PERSISTENTES (sobreviven al reinicio del proceso), a diferencia de
ejecutar_con_reintentos de bot.py (en memoria). NO usa Redis/Celery — la cola ES
la tabla cola_trabajo. Ver SPECS-9.md para el diseño cerrado.
"""
import logging
import os
import socket
from typing import Callable

import psycopg2
import psycopg2.extras

logger = logging.getLogger("norenty.cola")

COLA_TIMEOUT_HUERFANO_S = 300   # valor inicial razonable, NO pactado con cliente real
COLA_LOTE_DEFAULT = 10          # trabajos por tick

# Registro de handlers por kind. Un handler recibe el payload (dict) y lanza si
# falla (el fallo se captura arriba y dispara el backoff/dead-letter). Un kind
# sin handler registrado se trata como fallo ('kind desconocido'), nunca se pierde.
_HANDLERS: dict[str, Callable[[dict], None]] = {}


def registrar_handler(kind: str, fn: Callable[[dict], None]) -> None:
    """Registra el handler que procesa los trabajos de un `kind` dado."""
    _HANDLERS[kind] = fn


def enqueue(kind: str, payload: dict, *, empresa_id=None, max_intentos: int = 5,
            disponible_en=None) -> None:
    """Encola un trabajo (PRODUCTOR — hot path del bot, vía PostgREST).
    `disponible_en` opcional (ISO str) para trabajos diferidos; por defecto now().
    NO abre conexión psycopg2: reutiliza el cliente supabase ya instanciado.
    """
    from .db import supabase
    fila = {"kind": kind, "payload": payload, "max_intentos": max_intentos}
    if empresa_id is not None:
        fila["empresa_id"] = empresa_id
    if disponible_en is not None:
        fila["disponible_en"] = disponible_en
    supabase.table("cola_trabajo").insert(fila, returning="minimal").execute()
    # returning="minimal": no necesitamos la fila de vuelta y evita RETURNING/RLS
    # de más (patrón 0.2 de SPECS-7A). La tabla no tiene policy SELECT, así que
    # pedir RETURNING con service role funcionaría, pero minimal es lo correcto.


def _conectar():
    """Conexión psycopg2 directa (como migrate.py). Requiere DATABASE_URL."""
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def rescatar_huerfanos(cur, timeout_s: int = COLA_TIMEOUT_HUERFANO_S) -> int:
    """Devuelve a la cola los trabajos 'en_proceso' abandonados (el worker que
    los reclamó murió antes de marcar resultado). Si ya agotaron intentos,
    pasan a 'muerto' en vez de reintentar en bucle. Retorna nº rescatados."""
    cur.execute(
        """
        UPDATE public.cola_trabajo
           SET estado = CASE WHEN intentos >= max_intentos THEN 'muerto' ELSE 'fallido' END,
               ultimo_error = COALESCE(ultimo_error, 'huérfano: worker no marcó resultado'),
               disponible_en = now(),
               completado_en = CASE WHEN intentos >= max_intentos THEN now() ELSE completado_en END
         WHERE estado = 'en_proceso'
           AND reclamado_en < now() - (interval '1 second' * %(timeout)s)
        """,
        {"timeout": timeout_s},
    )
    return cur.rowcount


def reclamar_lote(cur, limite: int = COLA_LOTE_DEFAULT, worker_id: str | None = None) -> list[dict]:
    """Llama a cola_reclamar_lote() y devuelve las filas reclamadas como dicts."""
    cur.execute("SELECT * FROM cola_reclamar_lote(%s, %s)", (limite, worker_id or _worker_id()))
    return [dict(fila) for fila in cur.fetchall()]


def marcar_completado(cur, trabajo_id: str) -> None:
    """estado='completado', completado_en=now()."""
    cur.execute(
        "UPDATE public.cola_trabajo SET estado = 'completado', completado_en = now() WHERE id = %(id)s",
        {"id": trabajo_id},
    )


def marcar_fallido(cur, trabajo_id: str, intentos: int, max_intentos: int, error: str) -> None:
    """Backoff exponencial (base 2, unidad 60s) si quedan intentos; dead-letter
    ('muerto') permanente si `intentos` ya alcanzó `max_intentos`. `intentos`
    viene ya incrementado por el claim (cola_reclamar_lote), así que aquí se
    compara `>=` directamente."""
    cur.execute(
        """
        UPDATE public.cola_trabajo
           SET estado = CASE WHEN intentos >= max_intentos THEN 'muerto' ELSE 'fallido' END,
               ultimo_error = %(err)s,
               disponible_en = CASE WHEN intentos >= max_intentos
                                    THEN disponible_en
                                    ELSE now() + (interval '60 seconds' * power(2, intentos - 1)) END,
               completado_en = CASE WHEN intentos >= max_intentos THEN now() ELSE completado_en END
         WHERE id = %(id)s
        """,
        {"id": trabajo_id, "err": error},
    )
    if intentos >= max_intentos:
        logger.error(
            "Trabajo pasó a dead-letter (muerto): %s", error,
            extra={"trabajo_id": trabajo_id, "intentos": intentos, "max_intentos": max_intentos},
        )
        if os.environ.get("SENTRY_DSN"):
            try:
                import sentry_sdk
                with sentry_sdk.push_scope() as scope:
                    scope.set_tag("trabajo_id", trabajo_id)
                    scope.set_tag("intentos", intentos)
                    sentry_sdk.capture_message(f"cola_trabajo dead-letter: {error}", level="error")
            except Exception:
                pass


def procesar_uno(trabajo: dict) -> tuple[bool, str | None]:
    """Ejecuta el handler del kind del trabajo. FUNCIÓN PURA de enrutado (testeable
    con handlers fake, sin BD). Devuelve (ok, error). Un kind sin handler → (False,
    'kind desconocido: <kind>'). Una excepción del handler → (False, str(exc))."""
    kind = trabajo["kind"]
    handler = _HANDLERS.get(kind)
    if handler is None:
        return False, f"kind desconocido: {kind}"
    try:
        handler(trabajo["payload"])
        return True, None
    except Exception as exc:      # noqa: BLE001 — cualquier fallo del handler va al backoff
        return False, str(exc)


def tick(limite: int = COLA_LOTE_DEFAULT) -> dict:
    """Un ciclo completo del worker (SÍNCRONO, psycopg2). Pensado para llamarse
    desde el JobQueue del bot vía run_in_executor (NO bloquear el event loop) o
    desde un bucle de proceso separado en el futuro. Abre conexión, rescata
    huérfanos, reclama un lote, procesa cada trabajo y marca resultado; cada
    trabajo en su propia transacción para que un fallo no tumbe el lote entero.
    Devuelve {'reclamados': n, 'completados': n, 'fallidos': n, 'rescatados': n}.
    """
    resumen = {"reclamados": 0, "completados": 0, "fallidos": 0, "rescatados": 0}
    conn = _conectar()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            resumen["rescatados"] = rescatar_huerfanos(cur)
        conn.commit()

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            trabajos = reclamar_lote(cur, limite)
        conn.commit()
        resumen["reclamados"] = len(trabajos)

        for trabajo in trabajos:
            ok, error = procesar_uno(trabajo)
            with conn.cursor() as cur:
                if ok:
                    marcar_completado(cur, trabajo["id"])
                    resumen["completados"] += 1
                else:
                    marcar_fallido(cur, trabajo["id"], trabajo["intentos"], trabajo["max_intentos"], error)
                    resumen["fallidos"] += 1
            conn.commit()
    finally:
        conn.close()
    return resumen


# --- Handlers registrados (ítem 9.18 — ver SPECS-9.md §9.6) ---

registrar_handler("noop", lambda payload: None)


def _validar_pod_stub(payload: dict) -> None:
    """Validación de POD con visión LLM: PENDIENTE de la decisión de
    presupuesto D3/7B, no aprobada todavía. Si algo encola 'validar_pod' hoy,
    el trabajo pasa limpiamente a fallido→muerto con un ultimo_error claro —
    NUNCA se procesa a medias ni se pierde en silencio. Ver SPECS-9.md §9.6.1
    para el copy-paste exacto de cómo activarlo cuando se apruebe."""
    raise NotImplementedError("validar_pod: visión-LLM pendiente de aprobar D3/7B")


registrar_handler("validar_pod", _validar_pod_stub)
