"""Fake de Supabase para tests: imita la API encadenable .table().select().eq().execute()
sin tocar red. No pretende ser completo, solo cubre lo que usa app/bot.py.
"""


class FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeNotWrapper:
    """Espejo mínimo de `.not_` de postgrest-py: niega el siguiente filtro."""
    def __init__(self, query):
        self._query = query

    def is_(self, field, value):
        if value == "null":
            self._query._rows = [r for r in self._query._rows if r.get(field) is not None]
        else:
            self._query._rows = [r for r in self._query._rows if r.get(field) != value]
        return self._query

    def eq(self, field, value):
        self._query._rows = [r for r in self._query._rows if r.get(field) != value]
        return self._query


class FakeQuery:
    def __init__(self, rows):
        self._rows = list(rows)

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, field, value):
        self._rows = [r for r in self._rows if r.get(field) == value]
        return self

    def in_(self, field, values):
        self._rows = [r for r in self._rows if r.get(field) in values]
        return self

    def is_(self, field, value):
        # Espejo mínimo de postgrest-py: `.is_(col, "null")` == IS NULL.
        if value == "null":
            self._rows = [r for r in self._rows if r.get(field) is None]
        else:
            self._rows = [r for r in self._rows if r.get(field) == value]
        return self

    @property
    def not_(self):
        return _FakeNotWrapper(self)

    def order(self, field, desc=False):
        self._rows = sorted(self._rows, key=lambda r: (r.get(field) is None, r.get(field)), reverse=desc)
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def execute(self):
        return FakeResponse(self._rows)


class FakeInsert:
    def __init__(self, table_rows, payload):
        row = dict(payload)
        row.setdefault("id", f"fake-{len(table_rows)}")
        table_rows.append(row)
        self._row = row

    def execute(self):
        return FakeResponse([self._row])


class FakeUpdate:
    def __init__(self, rows, payload):
        self._rows = rows
        self._payload = payload
        self._filtered = list(rows)

    def eq(self, field, value):
        self._filtered = [r for r in self._filtered if r.get(field) == value]
        return self

    def execute(self):
        for r in self._filtered:
            r.update(self._payload)
        return FakeResponse(self._filtered)


class FakeTable:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_args, **_kwargs):
        return FakeQuery(self._rows)

    def insert(self, payload, **_kwargs):
        # **_kwargs: acepta (e ignora) returning="minimal" u otras opciones
        # del cliente real que no cambian el comportamiento del fake.
        return FakeInsert(self._rows, payload)

    def update(self, payload):
        return FakeUpdate(self._rows, payload)


class FakeStorageBucket:
    def __init__(self, uploads, bucket):
        self._uploads = uploads
        self._bucket = bucket

    def upload(self, path, file, file_options=None):
        self._uploads.append({"bucket": self._bucket, "path": path, "file": file, "file_options": file_options})
        return {"path": path}


class FakeStorage:
    """Cubre solo `.from_(bucket).upload(...)` — lo único que usa handle_photo
    (subida de POD, ítem 6.11 E2E)."""

    def __init__(self):
        self.uploads = []

    def from_(self, bucket):
        return FakeStorageBucket(self.uploads, bucket)


class FakeSupabase:
    """tables: dict tabla -> lista de filas (dicts). Las filas se mutan in-place
    al hacer insert/update, así que se pueden inspeccionar después en el test.
    """

    def __init__(self, tables=None):
        self.tables = {k: list(v) for k, v in (tables or {}).items()}
        self.storage = FakeStorage()

    def table(self, name):
        self.tables.setdefault(name, [])
        return FakeTable(self.tables[name])
