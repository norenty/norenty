"""Tests de crear_empresa_cliente.py (Fase 17, Bloque B.1) — lógica en memoria,
nunca toca Supabase real (mismo criterio que verificar_pod.py/verificar_incidencia_foto.py)."""
import pytest

from db.crear_empresa_cliente import crear_empresa_cliente
from tests.fakes import FakeSupabase


class FakeAuthUser:
    def __init__(self, user_id):
        self.id = user_id


class FakeInviteResult:
    def __init__(self, user_id):
        self.user = FakeAuthUser(user_id)


class FakeAuthAdmin:
    def __init__(self):
        self.invitados = []
        self._siguiente_id = 0
        self.forzar_error_invite = False

    def invite_user_by_email(self, email):
        if self.forzar_error_invite:
            raise RuntimeError("fallo simulado de invite_user_by_email")
        self._siguiente_id += 1
        user_id = f"auth-user-{self._siguiente_id}"
        self.invitados.append(email)
        return FakeInviteResult(user_id)


class FakeAuth:
    def __init__(self):
        self.admin = FakeAuthAdmin()


class FakeSupabaseConEmpresa(FakeSupabase):
    """Añade `.auth.admin` mínimo sobre el FakeSupabase ya existente (que ya
    cubre `.table()`) — no se toca fakes.py compartido para no arriesgar los
    tests del bot que ya lo usan."""
    def __init__(self, tables=None):
        super().__init__(tables=tables)
        self.auth = FakeAuth()


def test_crear_empresa_cliente_crea_empresa_gestor_admin_e_invita():
    sb = FakeSupabaseConEmpresa()

    r = crear_empresa_cliente(sb, "Transportes Ejemplo S.L.", "admin@ejemplo.com", "Ana García")

    assert sb.auth.admin.invitados == ["admin@ejemplo.com"]
    empresa = next(e for e in sb.tables["empresa"] if e["id"] == r["empresa_id"])
    assert empresa["nombre"] == "Transportes Ejemplo S.L."
    gestor = next(g for g in sb.tables["gestor"] if g["id"] == r["gestor_id"])
    assert gestor["empresa_id"] == r["empresa_id"]
    assert gestor["auth_user_id"] == r["auth_user_id"]
    assert gestor["rol"] == "admin"
    assert gestor["activo"] is True
    assert gestor["email"] == "admin@ejemplo.com"


def test_crear_empresa_cliente_rechaza_email_ya_existente():
    sb = FakeSupabaseConEmpresa(tables={"gestor": [{"id": "g1", "email": "ya@existe.com"}]})

    with pytest.raises(ValueError, match="ya existe un gestor"):
        crear_empresa_cliente(sb, "Otra Empresa", "ya@existe.com", "Alguien")

    # No debe haber invitado a nadie: el chequeo de duplicado va ANTES de invite_user_by_email.
    assert sb.auth.admin.invitados == []


def test_crear_empresa_cliente_no_deja_huerfano_silencioso_si_falla_la_empresa(monkeypatch):
    sb = FakeSupabaseConEmpresa()

    def insert_roto(payload, **_kwargs):
        raise RuntimeError("BD caída")

    sb.tables.setdefault("empresa", [])
    original_table = sb.table

    def table_con_fallo(name):
        t = original_table(name)
        if name == "empresa":
            t.insert = insert_roto
        return t

    sb.table = table_con_fallo

    with pytest.raises(RuntimeError, match="usuario de Auth creado"):
        crear_empresa_cliente(sb, "Empresa Rota", "roto@ejemplo.com", "Alguien")

    # El usuario de Auth SÍ se creó (side effect real de invite_user_by_email) -- el
    # mensaje de error debe decirlo para poder limpiarlo a mano, no desaparecerlo.
    assert sb.auth.admin.invitados == ["roto@ejemplo.com"]
