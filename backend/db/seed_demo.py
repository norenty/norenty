"""Puebla una empresa DEMO con datos realistas, pasando por RLS REAL (ítem 6.2).

Por qué esto importa: hasta ahora todo el desarrollo se ha verificado contra
fakes (tests) o contra una BD vacía. El bug de `tipo_evento` (2026-07-02,
commit fe056b6) habría sido detectado al instante si algo hubiera leído la
tabla `ejecucion_evento` de verdad. Este script crea un gestor demo, inicia
sesión con su ANON KEY (nunca service role — así valida las policies de RLS
tal cual las usará un cliente real) y puebla su empresa con:
  - 6 vehículos (tractoras/remolques, con coste_km)
  - 8 chóferes, uno por cada idioma soportado por el bot (es/en/ro/fr/ar/it/pt/de)
  - 25 viajes en distintos estados (planificado/en_curso/completado/cancelado)
    con hitos geocodificados a ciudades españolas reales, precio (para viabilidad)
  - eventos de ejecución (llegada/salida) en los viajes completados, para que
    nómina/analítica/puntualidad tengan señal real, no ceros
  - incidencias, valoraciones, documentos con caducidades próximas, 3 parkings propios
  - configuración de empresa (coste_km, base de operaciones, velocidad de
    planificación) para que viabilidad/nómina/ETA muestren números reales

Requiere en .env: SUPABASE_URL, SUPABASE_ANON_KEY, y DEMO_PASSWORD (contraseña
del gestor demo; si no existe la cuenta, se crea con supabase.auth.sign_up).

Idempotente: si la empresa demo ya existe, borra SOLO sus datos (documento,
viaje→hito/incidencia en cascada, chofer→valoracion en cascada, vehiculo,
parking propios) y los vuelve a poblar. Nunca toca otras empresas (todo pasa
por RLS bajo la sesión del gestor demo).

Uso:
    python backend/db/seed_demo.py
"""
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

# La consola de Windows por defecto usa cp1252, que no soporta tildes/ñ; sin esto
# cualquier print con texto en español (normal en este proyecto) revienta con
# UnicodeEncodeError a mitad de ejecución.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env", override=True)
# Seguridad (2026-07-08): secretos reales en ~/.norenty-secrets/.env, fuera del
# repo (ver RUNBOOK-SECRETS.md). Se carga el ultimo para que gane sobre lo anterior.
load_dotenv(Path.home() / ".norenty-secrets" / ".env", override=True)

DEMO_EMAIL = os.environ.get("DEMO_EMAIL", "demo@norenty.com")
DEMO_EMPRESA_NOMBRE = "Transportes Demo Norenty"

random.seed(42)  # reproducible: cada ejecución genera los mismos datos

CIUDADES = [
    ("Madrid", 40.4168, -3.7038), ("Barcelona", 41.3851, 2.1734),
    ("Valencia", 39.4699, -0.3763), ("Sevilla", 37.3891, -5.9845),
    ("Zaragoza", 41.6488, -0.8891), ("Málaga", 36.7213, -4.4214),
    ("Bilbao", 43.2630, -2.9350), ("Murcia", 37.9922, -1.1307),
    ("Alicante", 38.3452, -0.4810), ("Valladolid", 41.6523, -4.7245),
    ("Vigo", 42.2406, -8.7207), ("Gijón", 43.5322, -5.6611),
    ("A Coruña", 43.3623, -8.4115), ("Vitoria", 42.8467, -2.6716),
    ("Pamplona", 42.8125, -1.6458),
]

CHOFERES = [
    ("Mario García", "es"), ("John Smith", "en"), ("Ion Popescu", "ro"),
    ("Jean Dupont", "fr"), ("Ahmed El Amrani", "ar"), ("Marco Rossi", "it"),
    ("João Silva", "pt"), ("Hans Weber", "de"),
]

VEHICULOS = [
    ("1234ABC", "tractora", "Volvo", "FH16", 1.15),
    ("5678BCD", "tractora", "Scania", "R450", 1.25),
    ("9012CDE", "tractora", "MAN", "TGX", 1.10),
    ("3456DEF", "remolque", "Schmitz", "Cargobull", None),
    ("7890EFG", "remolque", "Krone", "Profi Liner", None),
    ("2468FGH", "rigido", "Iveco", "Eurocargo", 0.95),
]

INCIDENCIA_TIPOS = ["averia", "retraso", "fuera_de_ventana", "incidencia_cliente", "otro"]


def rand_ciudad(excluir=None):
    opciones = [c for c in CIUDADES if c[0] != excluir] if excluir else CIUDADES
    return random.choice(opciones)


def main():
    demo_password = os.environ.get("DEMO_PASSWORD")
    if not demo_password:
        print("ERROR: falta DEMO_PASSWORD en el entorno (.env).")
        return

    url = os.environ["SUPABASE_URL"]
    anon_key = os.environ["SUPABASE_ANON_KEY"]
    sb = create_client(url, anon_key)

    # --- Login o alta del gestor demo (nunca service role: RLS real) ---
    try:
        sb.auth.sign_in_with_password({"email": DEMO_EMAIL, "password": demo_password})
        print(f"Login OK como {DEMO_EMAIL}.")
    except Exception:
        sb.auth.sign_up({"email": DEMO_EMAIL, "password": demo_password})
        print(f"Cuenta demo creada: {DEMO_EMAIL}.")

    session = sb.auth.get_session()
    if not session:
        print("ERROR: no se obtuvo sesion. Si el proyecto exige confirmar email, "
              "desactivalo en Supabase (Authentication > Providers > Email), o "
              "confirma manualmente la cuenta demo una vez.")
        return
    user_id = session.user.id

    existente = sb.table("gestor").select("id, empresa_id").eq("auth_user_id", user_id).limit(1).execute()
    if existente.data:
        empresa_id = existente.data[0]["empresa_id"]
    else:
        # Bootstrap (mismo fix que dashboard/lib/auth.js, ver PROGRESS.md 2026-07-02):
        # sin fila en `gestor` todavia, current_empresa_id() es NULL y la policy
        # SELECT tanto de `empresa` como de `gestor` no ve ninguna fila -- ni la
        # que acabamos de crear. Generar el id en el cliente Y pedir
        # returning="minimal" (postgrest-py, a diferencia de supabase-js, SI pide
        # RETURNING por defecto en insert()) evita depender de esa visibilidad
        # antes de tiempo en ambos inserts.
        empresa_id = str(uuid.uuid4())
        sb.table("empresa").insert(
            {"id": empresa_id, "nombre": DEMO_EMPRESA_NOMBRE}, returning="minimal"
        ).execute()
        sb.table("gestor").insert({
            "nombre": "Demo", "email": DEMO_EMAIL,
            "empresa_id": empresa_id, "auth_user_id": user_id,
        }, returning="minimal").execute()
    print(f"Empresa demo: {empresa_id}")

    # --- Idempotente: borra SOLO los datos de esta empresa (RLS ya lo garantiza) ---
    sb.table("documento").delete().eq("empresa_id", empresa_id).execute()
    sb.table("viaje").delete().eq("empresa_id", empresa_id).execute()  # cascada: hito, incidencia
    sb.table("chofer").delete().eq("empresa_id", empresa_id).execute()  # cascada: valoracion
    sb.table("vehiculo").delete().eq("empresa_id", empresa_id).execute()
    sb.table("parking").delete().eq("empresa_id", empresa_id).eq("fuente", "empresa").execute()
    print("Datos previos de la empresa demo borrados.")

    # --- Configuración de empresa: base + costes, para que viabilidad/nómina/ETA calculen de verdad ---
    base = CIUDADES[0]  # Madrid
    sb.table("empresa").update({
        "base_lat": base[1], "base_lon": base[2],
        "coste_km": 1.20, "velocidad_planificacion_kmh": 75,
    }).eq("id", empresa_id).execute()

    # --- Vehículos ---
    vehiculo_ids = []
    for matricula, tipo, marca, modelo, coste_km in VEHICULOS:
        r = sb.table("vehiculo").insert({
            "empresa_id": empresa_id, "matricula": matricula, "tipo": tipo,
            "marca": marca, "modelo": modelo, "coste_km": coste_km,
        }).execute()
        vehiculo_ids.append(r.data[0]["id"])
    tractoras = vehiculo_ids[:3] + vehiculo_ids[5:]  # tractora/rigido pueden llevar viaje
    remolques = vehiculo_ids[3:5]
    print(f"{len(vehiculo_ids)} vehículos creados.")

    # --- Chóferes ---
    chofer_ids = []
    for nombre, idioma in CHOFERES:
        r = sb.table("chofer").insert({
            "empresa_id": empresa_id, "nombre": nombre, "idioma": idioma,
        }).execute()
        chofer_ids.append(r.data[0]["id"])
    print(f"{len(chofer_ids)} chóferes creados.")

    # --- Viajes + hitos (+ eventos de ejecución para los completados) ---
    ahora = datetime.now(timezone.utc)
    ESTADOS = (
        ["planificado"] * 6 + ["en_curso"] * 5 + ["completado"] * 11 + ["cancelado"] * 3
    )
    n_incidencia = n_valoracion = 0

    # La BD tiene índices únicos parciales: un chófer/vehículo/remolque no puede
    # estar en más de un viaje ACTIVO (planificado/en_curso) a la vez (protegen
    # contra doble asignación real). Con 25 viajes demo y solo 8 chóferes/4
    # tractoras/2 remolques, no todos los viajes activos pueden llevar asignación
    # -- se deja sin asignar cuando el pool activo se agota, tal y como pasaría
    # de verdad ("planificado sin asignar todavía").
    activos_chofer, activos_vehiculo, activos_remolque = set(), set(), set()

    def elegir_libre(pool, usados):
        libres = [x for x in pool if x not in usados]
        if not libres:
            return None
        return random.choice(libres)

    for i, estado in enumerate(ESTADOS):
        ref = f"DEMO-{i + 1:03d}"
        origen = rand_ciudad()
        destino = rand_ciudad(excluir=origen[0])
        es_activo = estado in ("planificado", "en_curso")

        if es_activo:
            chofer_id = elegir_libre(chofer_ids, activos_chofer) if random.random() > 0.2 else None
            vehiculo_id = elegir_libre(tractoras, activos_vehiculo) if chofer_id else None
            remolque_id = elegir_libre(remolques, activos_remolque) if vehiculo_id and random.random() > 0.5 else None
            if chofer_id:
                activos_chofer.add(chofer_id)
            if vehiculo_id:
                activos_vehiculo.add(vehiculo_id)
            if remolque_id:
                activos_remolque.add(remolque_id)
        else:
            # completado/cancelado: no hay restricción de unicidad, cualquier recurso vale.
            chofer_id = random.choice(chofer_ids)
            vehiculo_id = random.choice(tractoras)
            remolque_id = random.choice(remolques) if random.random() > 0.5 else None

        precio = round(random.uniform(300, 2200), 2)

        creado_hace_dias = random.randint(0, 45)
        creado_en = ahora - timedelta(days=creado_hace_dias)

        viaje = sb.table("viaje").insert({
            "empresa_id": empresa_id, "referencia": ref, "estado": estado,
            "chofer_id": chofer_id, "vehiculo_id": vehiculo_id, "remolque_id": remolque_id,
            "precio": precio,
        }).execute().data[0]
        viaje_id = viaje["id"]

        # Hitos: recogida en origen + 1-2 entregas hacia destino (y a veces una 2ª ciudad).
        puntos = [("recogida", origen)]
        puntos.append(("entrega", destino))
        if random.random() > 0.6:
            puntos.append(("entrega", rand_ciudad(excluir=destino[0])))

        hitos_completado = estado == "completado"
        hitos_parcial = estado == "en_curso"
        hito_ids = []
        for orden, (tipo_hito, (nombre_ciudad, lat, lon)) in enumerate(puntos, start=1):
            ventana_inicio = creado_en + timedelta(hours=orden * 6)
            ventana_fin = ventana_inicio + timedelta(hours=3)
            if hitos_completado:
                hito_estado = "completado"
            elif hitos_parcial:
                hito_estado = "completado" if orden == 1 else ("en_curso" if orden == 2 else "pendiente")
            elif estado == "cancelado":
                hito_estado = "pendiente"
            else:
                hito_estado = "pendiente"

            h = sb.table("hito").insert({
                "viaje_id": viaje_id, "orden": orden, "tipo": tipo_hito,
                "direccion": f"{nombre_ciudad}, España", "lat": lat, "lon": lon,
                "ventana_inicio": ventana_inicio.isoformat(), "ventana_fin": ventana_fin.isoformat(),
                "estado": hito_estado,
            }).execute().data[0]
            hito_ids.append((h["id"], hito_estado, ventana_fin))

        # Eventos de ejecución realistas para los hitos completados (nómina/analítica los necesitan).
        if chofer_id:
            for hito_id, hito_estado, ventana_fin in hito_ids:
                if hito_estado != "completado":
                    continue
                llegada = ventana_fin - timedelta(minutes=random.randint(-30, 45))
                sb.table("ejecucion_evento").insert({
                    "viaje_id": viaje_id, "hito_id": hito_id, "chofer_id": chofer_id,
                    "tipo": "llegada", "ocurrido_en": llegada.isoformat(), "datos": {},
                }).execute()
                sb.table("ejecucion_evento").insert({
                    "viaje_id": viaje_id, "hito_id": hito_id, "chofer_id": chofer_id,
                    "tipo": "salida", "ocurrido_en": (llegada + timedelta(minutes=20)).isoformat(), "datos": {},
                }).execute()
            if estado == "completado":
                sb.table("ejecucion_evento").insert({
                    "viaje_id": viaje_id, "chofer_id": chofer_id,
                    "tipo": "viaje_completado", "ocurrido_en": ahora.isoformat(), "datos": {},
                }).execute()

        # Incidencias en ~1 de cada 4 viajes activos/completados.
        if estado in ("en_curso", "completado") and random.random() > 0.75:
            n_incidencia += 1
            sb.table("incidencia").insert({
                "viaje_id": viaje_id, "tipo": random.choice(INCIDENCIA_TIPOS),
                "descripcion": "Incidencia de demostración generada por seed_demo.py",
                "estado": random.choice(["abierta", "en_revision", "resuelta"]),
            }).execute()

        # Valoración del chófer en viajes completados.
        if estado == "completado" and chofer_id and random.random() > 0.3:
            n_valoracion += 1
            sb.table("valoracion").insert({
                "chofer_id": chofer_id, "viaje_id": viaje_id,
                "puntuacion": random.randint(3, 5),
                "nota": random.choice([None, "Buen servicio", "Puntual y sin incidencias", None]),
            }).execute()

    print(f"{len(ESTADOS)} viajes creados ({n_incidencia} incidencias, {n_valoracion} valoraciones).")

    # --- Documentos con caducidades próximas (algunas ya caducadas, otras por caducar) ---
    documentos = [
        ("chofer", chofer_ids[0], "licencia", -5),
        ("chofer", chofer_ids[1], "cap", 12),
        ("vehiculo", vehiculo_ids[0], "itv", 20),
        ("vehiculo", vehiculo_ids[1], "seguro", -2),
        ("viaje", None, "cmr", 25),
    ]
    hoy = ahora.date()
    for ambito, entidad_id, tipo, dias in documentos:
        if entidad_id is None:
            continue
        fecha_cad = hoy + timedelta(days=dias)
        sb.table("documento").insert({
            "empresa_id": empresa_id, "ambito": ambito, "entidad_id": entidad_id,
            "tipo": tipo, "fecha_caducidad": fecha_cad.isoformat(),
        }).execute()
    print("Documentos demo creados (con caducidades próximas/vencidas).")

    # --- Parkings propios (3, distintos de los del dataset abierto) ---
    parkings_propios = [
        ("Parking propio Polígono Norte", 40.50, -3.60),
        ("Área de descanso km 120 A-2", 41.20, -1.50),
        ("Parking de confianza Sevilla Este", 37.42, -5.90),
    ]
    for nombre, lat, lon in parkings_propios:
        sb.table("parking").insert({
            "empresa_id": empresa_id, "nombre": nombre, "tipo": "parking",
            "lat": lat, "lon": lon, "fuente": "empresa",
            "notas": "Parking de demostración (seed_demo.py)",
        }).execute()
    print("3 parkings propios creados.")

    print(f"\nOK. Entra con {DEMO_EMAIL} / (la contraseña de DEMO_PASSWORD) para ver la demo.")


if __name__ == "__main__":
    main()
