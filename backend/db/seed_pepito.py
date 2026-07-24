"""Genera una empresa ficticia GRANDE para pruebas manuales (2026-07-22).

Por qué esto existe: la empresa demo (`seed_demo.py`) tiene 6 vehículos y 8
chóferes -- suficiente para tests automáticos, insuficiente para probar de
verdad los buscadores nuevos (Buscador.jsx, autocompletado de direcciones,
sugerencia de chófer) con volumen realista. Este script crea "Transportes
Pepito S.L." con ~70 vehículos, 80 chóferes, 10 clientes con 7 rutas
(plantilla_ruta) cada uno, y TODOS los documentos obligatorios ya vigentes
(licencia/CAP de chófer, ITV/seguro/autorización de vehículo) -- para que
poner un viaje "en curso" no choque con documentación faltante, que es
exactamente lo que bloqueó la prueba manual que dio origen a este script.

Usa SUPABASE_SERVICE_ROLE_KEY directamente (bypassa RLS) a propósito: el
objetivo es velocidad de generación de datos de prueba, no validar RLS (eso
ya lo hacen `isolation.test.js`/`roles-isolation.test.js`) -- la seguridad en
tiempo de uso normal no depende de cómo se creó la fila, sigue aplicando RLS
igual cuando el gestor de Pepito entre a mirar sus datos.

SALVAGUARDA: se niega a correr si SUPABASE_URL apunta al proyecto de
PRODUCCIÓN conocido (norenty-prod, ref tgnaceimcbuknbihzxmi) -- esto es
SOLO para el entorno de dev.

Idempotente: si "Transportes Pepito S.L." ya existe, borra toda su cascada y
la recrea desde cero (mismos criterios reproducibles, semilla fija).

Uso:
    python backend/db/seed_pepito.py
"""
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env", override=True)
load_dotenv(Path.home() / ".norenty-secrets" / ".env", override=True)

PROJECT_REF_PROD = "tgnaceimcbuknbihzxmi"  # norenty-prod -- freno de seguridad, ver docstring

EMPRESA_NOMBRE = "Transportes Pepito S.L."
ADMIN_EMAIL = "admin@transportespepito.test"
ADMIN_PASSWORD = "PepitoTest2026!"

random.seed(7)  # reproducible

N_TRACTORAS = 45
N_REMOLQUES = 25
N_CHOFERES = 80
N_CLIENTES = 10
RUTAS_POR_CLIENTE = 7

CIUDADES = [
    ("Madrid", 40.4168, -3.7038), ("Barcelona", 41.3851, 2.1734),
    ("Valencia", 39.4699, -0.3763), ("Sevilla", 37.3891, -5.9845),
    ("Zaragoza", 41.6488, -0.8891), ("Málaga", 36.7213, -4.4214),
    ("Bilbao", 43.2630, -2.9350), ("Murcia", 37.9922, -1.1307),
    ("Alicante", 38.3452, -0.4810), ("Valladolid", 41.6523, -4.7245),
    ("Vigo", 42.2406, -8.7207), ("Gijón", 43.5322, -5.6611),
    ("A Coruña", 43.3623, -8.4115), ("Vitoria", 42.8467, -2.6716),
    ("Pamplona", 42.8125, -1.6458), ("Córdoba", 37.8882, -4.7794),
    ("Granada", 37.1773, -3.5986), ("Toledo", 39.8628, -4.0273),
    ("Burgos", 42.3439, -3.6969), ("Logroño", 42.4627, -2.4449),
    ("Lisboa", 38.7223, -9.1393), ("Oporto", 41.1579, -8.6291),
    ("Toulouse", 43.6047, 1.4442), ("Burdeos", 44.8378, -0.5792),
    ("Marsella", 43.2965, 5.3698), ("Milán", 45.4642, 9.1900),
    ("Fráncfort", 50.1109, 8.6821), ("Ámsterdam", 52.3676, 4.9041),
]

NOMBRES = [
    "Antonio", "María", "José", "Carmen", "Manuel", "Ana", "Francisco", "Isabel",
    "David", "Laura", "Juan", "Marta", "Javier", "Elena", "Carlos", "Cristina",
    "Miguel", "Lucía", "Rafael", "Paula", "Pedro", "Sara", "Ángel", "Sandra",
    "Alejandro", "Rocío", "Fernando", "Nuria", "Sergio", "Beatriz", "Pablo", "Silvia",
    "Adrián", "Raquel", "Diego", "Alba", "Iván", "Patricia", "Álvaro", "Eva",
]
APELLIDOS = [
    "García", "Rodríguez", "González", "Fernández", "López", "Martínez", "Sánchez",
    "Pérez", "Gómez", "Martín", "Jiménez", "Ruiz", "Hernández", "Díaz", "Moreno",
    "Muñoz", "Álvarez", "Romero", "Alonso", "Gutiérrez",
]
IDIOMAS_POOL = ["es"] * 60 + ["en"] * 5 + ["ro"] * 5 + ["fr"] * 4 + ["it"] * 3 + ["pt"] * 3

MARCAS_TRACTORA = [
    ("Volvo", "FH16"), ("Scania", "R450"), ("MAN", "TGX"), ("DAF", "XF"),
    ("Mercedes-Benz", "Actros"), ("Iveco", "S-Way"), ("Renault", "T High"),
]
MARCAS_REMOLQUE = [
    ("Schmitz", "Cargobull"), ("Krone", "Profi Liner"), ("Lecitrailer", "Frigo"),
    ("Guillén", "Lonero"), ("Fruehauf", "Furgón"),
]

CLIENTES = [
    "Adidas España", "Mercadona Logística", "Ikea Distribución", "El Corte Inglés",
    "Danone Iberia", "Leroy Merlin", "Grupo Calvo", "Zara Distribution",
    "Campofrío", "Nestlé España",
]


def matricula_aleatoria(usadas):
    while True:
        m = f"{random.randint(0, 9999):04d}" + "".join(random.choices("BCDFGHJKLMNPRSTVWXYZ", k=3))
        if m not in usadas:
            usadas.add(m)
            return m


def nombre_chofer_unico(usados):
    while True:
        n = f"{random.choice(NOMBRES)} {random.choice(APELLIDOS)}"
        if n not in usados:
            usados.add(n)
            return n


def main():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    if PROJECT_REF_PROD in url:
        print("ERROR: SUPABASE_URL apunta al proyecto de PRODUCCION. Abortado a propósito.")
        sys.exit(1)

    sb = create_client(url, key)

    existente = sb.table("empresa").select("id").eq("nombre", EMPRESA_NOMBRE).execute()
    if existente.data:
        empresa_id = existente.data[0]["id"]
        sb.table("documento").delete().eq("empresa_id", empresa_id).execute()
        sb.table("plantilla_ruta").delete().eq("empresa_id", empresa_id).execute()
        sb.table("cliente").delete().eq("empresa_id", empresa_id).execute()
        sb.table("viaje").delete().eq("empresa_id", empresa_id).execute()
        sb.table("chofer").delete().eq("empresa_id", empresa_id).execute()
        sb.table("vehiculo").delete().eq("empresa_id", empresa_id).execute()
        sb.table("gestor").delete().eq("empresa_id", empresa_id).execute()
        sb.table("empresa").delete().eq("id", empresa_id).execute()
        print("Empresa Pepito previa borrada, recreando desde cero.")

    base = CIUDADES[0]
    empresa_id = str(uuid.uuid4())
    sb.table("empresa").insert({
        "id": empresa_id, "nombre": EMPRESA_NOMBRE,
        "base_lat": base[1], "base_lon": base[2],
        "coste_km": 1.15, "velocidad_planificacion_kmh": 78,
        "objetivo_puntualidad_pct": 90, "margen_objetivo_pct": 15,
    }).execute()

    # --- Admin de la empresa (login real para poder entrar como Pepito) ---
    try:
        creado = sb.auth.admin.create_user({
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "email_confirm": True,
        })
        auth_user_id = creado.user.id
    except Exception:
        pagina = sb.auth.admin.list_users()
        auth_user_id = next(u.id for u in pagina if u.email == ADMIN_EMAIL)

    sb.table("gestor").insert({
        "empresa_id": empresa_id, "nombre": "Admin Pepito", "email": ADMIN_EMAIL,
        "auth_user_id": auth_user_id, "rol": "admin", "activo": True,
    }).execute()

    hoy = datetime.now(timezone.utc).date()
    fecha_vigente = (hoy + timedelta(days=365)).isoformat()

    # --- Vehículos + documentos vigentes ---
    matriculas_usadas = set()
    for _ in range(N_TRACTORAS):
        marca, modelo = random.choice(MARCAS_TRACTORA)
        v = sb.table("vehiculo").insert({
            "empresa_id": empresa_id, "matricula": matricula_aleatoria(matriculas_usadas),
            "tipo": "tractora", "marca": marca, "modelo": modelo,
            "coste_km": round(random.uniform(1.05, 1.35), 2), "activo": True,
        }).execute().data[0]
        for tipo_doc in ("itv", "seguro", "autorizacion_transporte"):
            sb.table("documento").insert({
                "empresa_id": empresa_id, "ambito": "vehiculo", "entidad_id": v["id"],
                "tipo": tipo_doc, "fecha_caducidad": fecha_vigente,
            }).execute()

    for _ in range(N_REMOLQUES):
        marca, modelo = random.choice(MARCAS_REMOLQUE)
        v = sb.table("vehiculo").insert({
            "empresa_id": empresa_id, "matricula": matricula_aleatoria(matriculas_usadas),
            "tipo": "remolque", "marca": marca, "modelo": modelo, "activo": True,
        }).execute().data[0]
        for tipo_doc in ("itv", "seguro"):
            sb.table("documento").insert({
                "empresa_id": empresa_id, "ambito": "vehiculo", "entidad_id": v["id"],
                "tipo": tipo_doc, "fecha_caducidad": fecha_vigente,
            }).execute()
    print(f"{N_TRACTORAS} tractoras + {N_REMOLQUES} remolques creados, con documentos vigentes.")

    # --- Chóferes + documentos vigentes ---
    nombres_usados = set()
    for _ in range(N_CHOFERES):
        c = sb.table("chofer").insert({
            "empresa_id": empresa_id, "nombre": nombre_chofer_unico(nombres_usados),
            "idioma": random.choice(IDIOMAS_POOL),
        }).execute().data[0]
        for tipo_doc in ("licencia", "cap"):
            sb.table("documento").insert({
                "empresa_id": empresa_id, "ambito": "chofer", "entidad_id": c["id"],
                "tipo": tipo_doc, "fecha_caducidad": fecha_vigente,
            }).execute()
    print(f"{N_CHOFERES} chóferes creados, con documentos vigentes.")

    # --- Clientes + 7 rutas (plantilla_ruta) cada uno, ciudades variadas ---
    n_rutas = 0
    for nombre_cliente in CLIENTES[:N_CLIENTES]:
        cliente = sb.table("cliente").insert({"empresa_id": empresa_id, "nombre": nombre_cliente, "activo": True}).execute().data[0]
        for j in range(RUTAS_POR_CLIENTE):
            origen = random.choice(CIUDADES)
            destino = random.choice([c for c in CIUDADES if c[0] != origen[0]])
            plantilla = sb.table("plantilla_ruta").insert({
                "empresa_id": empresa_id, "cliente_id": cliente["id"],
                "nombre": f"{nombre_cliente} · Ruta {j + 1}: {origen[0]} → {destino[0]}",
            }).execute().data[0]
            sb.table("plantilla_hito").insert([
                {"plantilla_ruta_id": plantilla["id"], "orden": 1, "tipo": "recogida",
                 "direccion": f"{origen[0]}, España" if origen[0] not in ("Lisboa", "Oporto", "Toulouse", "Burdeos", "Marsella", "Milán", "Fráncfort", "Ámsterdam") else origen[0],
                 "lat": origen[1], "lon": origen[2]},
                {"plantilla_ruta_id": plantilla["id"], "orden": 2, "tipo": "entrega",
                 "direccion": f"{destino[0]}, España" if destino[0] not in ("Lisboa", "Oporto", "Toulouse", "Burdeos", "Marsella", "Milán", "Fráncfort", "Ámsterdam") else destino[0],
                 "lat": destino[1], "lon": destino[2]},
            ]).execute()
            n_rutas += 1
    print(f"{N_CLIENTES} clientes creados, con {n_rutas} rutas (plantillas) en total.")

    print(f"\nOK. Empresa: {EMPRESA_NOMBRE} ({empresa_id})")
    print(f"Login: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")


if __name__ == "__main__":
    main()
