"""Alta controlada de una empresa cliente (Fase 17, Bloque B.1).

Sustituye al autoregistro público que se quitó de LoginPage.jsx (2026-07-19,
decisión de modelo B2B: nada de "cualquiera crea su empresa sin invitación").
Este es el único camino para que exista una empresa nueva en producción: lo
ejecuta el admin del proyecto (nosotros), nunca un visitante de la web.

Qué hace, en orden:
1. Invita al primer usuario por email (`auth.admin.invite_user_by_email`) —
   Supabase crea la cuenta y le manda a ÉL el correo para poner su propia
   contraseña. Ni este script ni nosotros la vemos ni la elegimos.
2. Crea la fila `empresa`.
3. Crea la fila `gestor` vinculada a ese usuario, con `rol='admin'` (el
   default de la tabla, pero explícito aquí para que quede documentado) y
   `activo=true`.

Si algo falla a mitad (p. ej. el paso 2 o 3 tras el 1), el usuario de Auth
queda creado pero sin empresa/gestor asociados — el script lo avisa en vez de
dejarlo en silencio, para poder limpiarlo a mano desde el panel de Supabase
(Authentication → Users → borrar) y reintentar.

Uso:
    python backend/db/crear_empresa_cliente.py --empresa "Transportes Ejemplo S.L." --email admin@ejemplo.com --nombre "Nombre Apellido"
"""
import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent.parent.parent / ".env")
load_dotenv(Path.home() / ".norenty-secrets" / ".env", override=True)


def _cliente():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def crear_empresa_cliente(sb, empresa_nombre: str, email: str, nombre_admin: str) -> dict:
    """Devuelve {'empresa_id', 'gestor_id', 'auth_user_id'}. Lanza si algo falla."""
    existente = sb.table("gestor").select("id").eq("email", email).execute()
    if existente.data:
        raise ValueError(f"ya existe un gestor con el email {email} (gestor_id={existente.data[0]['id']})")

    invitado = sb.auth.admin.invite_user_by_email(email)
    auth_user_id = invitado.user.id

    try:
        empresa = sb.table("empresa").insert({"nombre": empresa_nombre}).execute()
        empresa_id = empresa.data[0]["id"]
    except Exception as exc:
        raise RuntimeError(
            f"usuario de Auth creado ({auth_user_id}) pero FALLÓ crear la empresa: {exc}. "
            f"Borra el usuario a mano en Supabase → Authentication → Users antes de reintentar."
        ) from exc

    try:
        gestor = sb.table("gestor").insert({
            "empresa_id": empresa_id,
            "nombre": nombre_admin,
            "email": email,
            "auth_user_id": auth_user_id,
            "rol": "admin",
            "activo": True,
        }).execute()
        gestor_id = gestor.data[0]["id"]
    except Exception as exc:
        raise RuntimeError(
            f"usuario de Auth ({auth_user_id}) y empresa ({empresa_id}) creados pero FALLÓ crear "
            f"el gestor: {exc}. Limpieza manual necesaria antes de reintentar."
        ) from exc

    return {"empresa_id": empresa_id, "gestor_id": gestor_id, "auth_user_id": auth_user_id}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--empresa", required=True, help="Nombre de la empresa cliente")
    parser.add_argument("--email", required=True, help="Email del primer admin (recibirá el correo de invitación)")
    parser.add_argument("--nombre", required=True, help="Nombre del primer admin")
    args = parser.parse_args()

    sb = _cliente()
    try:
        resultado = crear_empresa_cliente(sb, args.empresa, args.email, args.nombre)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    except RuntimeError as exc:
        print(f"ERROR PARCIAL: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Empresa creada: {resultado['empresa_id']}")
    print(f"Gestor admin creado: {resultado['gestor_id']}")
    print(f"Invitación enviada a {args.email} — debe revisar su correo para poner su contraseña.")


if __name__ == "__main__":
    main()
