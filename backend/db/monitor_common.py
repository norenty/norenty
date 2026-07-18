"""Utilidades compartidas por los 4 monitores standalone de backend/db/
(monitor_heartbeat.py, monitor_retraso_silencioso.py, monitor_checkpoint_saltado.py,
monitor_integridad.py).

Cada uno se escribió copiando el patrón del anterior -- carga de .env, comprobación de
variables de entorno requeridas, conexión/commit/rollback/close de psycopg2, y el POST
directo a la Bot API de Telegram. Esta duplicación real se detectó al construir un grafo
de conocimiento del repo (graphify, 2026-07-18), que la señaló como "conexión sorprendente"
entre los 4 scripts. Se centraliza aquí sin cambiar ningún comportamiento -- cada monitor
sigue teniendo su propia lógica de negocio (`revisar_*`), solo deja de copiar y pegar el
andamiaje alrededor.
"""
import os
import sys
import urllib.request
import urllib.parse
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


def cargar_env():
    """Mismos dos load_dotenv que llevaba cada monitor por separado: el .env del repo
    primero, luego ~/.norenty-secrets/.env con override=True (secretos reales fuera del
    repo, ver RUNBOOK-SECRETS.md)."""
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
    load_dotenv(Path.home() / ".norenty-secrets" / ".env", override=True)


def requerir_env(*nombres):
    """Lee cada variable de entorno de la lista; si falta alguna, imprime un error claro
    por stderr y termina con exit(1) -- mismo patrón que llevaba cada monitor en su main().
    Devuelve un solo valor si se pide una variable, o una tupla si se piden varias."""
    valores = []
    faltan = []
    for nombre in nombres:
        valor = os.environ.get(nombre)
        if not valor:
            faltan.append(nombre)
        valores.append(valor)
    if faltan:
        print(f"ERROR: falta {', '.join(faltan)} en el entorno.", file=sys.stderr)
        sys.exit(1)
    return valores[0] if len(valores) == 1 else tuple(valores)


def ejecutar_con_conexion(database_url, fn, cursor_factory=None):
    """Abre la conexión a `database_url`, ejecuta fn(cur) dentro de una transacción,
    hace commit si todo va bien o rollback si fn lanza, y siempre cierra la conexión --
    el try/except/finally que llevaba cada main() por separado. Devuelve lo que fn
    devuelva."""
    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        with conn.cursor(cursor_factory=cursor_factory) as cur:
            resultado = fn(cur)
        conn.commit()
        return resultado
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def enviar_telegram(token: str, chat_id: str, texto: str):
    """POST directo a la Bot API de Telegram -- NO reutiliza el proceso del bot (a
    propósito: si el bot está caído, solo un cliente HTTP independiente puede avisar de
    que lo está)."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": texto}).encode("utf-8")
    with urllib.request.urlopen(url, data=data, timeout=15) as resp:
        return resp.status == 200


def obtener_chats_gestores(cur):
    """chat_id de gestores activos con Telegram vinculado, de TODAS las empresas -- para
    monitores globales que no son por-empresa (heartbeat, integridad). Los monitores
    por-empresa (retraso_silencioso, checkpoint_saltado) tienen su propia consulta
    filtrada por empresa_id/preferencia/asignación de Fase 15, no usan esta."""
    cur.execute("SELECT telegram_chat_id FROM gestor WHERE telegram_chat_id IS NOT NULL AND activo = true")
    return [fila[0] for fila in cur.fetchall()]
