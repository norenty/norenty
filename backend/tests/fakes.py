"""Fake de Supabase para tests: imita la API encadenable .table().select().eq().execute()
sin tocar red. No pretende ser completo, solo cubre lo que usa app/bot.py.
"""


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, rows):
        self._rows = list(rows)

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, field, value):
        self._rows = [r for r in self._rows if r.get(field) == value]
        return self

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

    def insert(self, payload):
        return FakeInsert(self._rows, payload)

    def update(self, payload):
        return FakeUpdate(self._rows, payload)


class FakeSupabase:
    """tables: dict tabla -> lista de filas (dicts). Las filas se mutan in-place
    al hacer insert/update, así que se pueden inspeccionar después en el test.
    """

    def __init__(self, tables=None):
        self.tables = {k: list(v) for k, v in (tables or {}).items()}

    def table(self, name):
        self.tables.setdefault(name, [])
        return FakeTable(self.tables[name])
