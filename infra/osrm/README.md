# OSRM local (routing por carretera real)

Servicio de routing que usa el dashboard para calcular **km por carretera real**
entre hitos de un viaje (informe de nómina, ítem 5.1 del ROADMAP). El cliente
vive en `dashboard/lib/osrm.js` y habla con el endpoint HTTP de OSRM.

> **Solo desarrollo/test.** El despliegue de OSRM en producción está pospuesto
> junto con la sección "Despliegue" del ROADMAP. No lo actives en producción
> desde aquí.

## Preparación (una sola vez)

El extracto de OpenStreetMap de España (`.osm.pbf`, cientos de MB) **no está
versionado**. Hay que descargarlo de [Geofabrik](https://download.geofabrik.de/)
y preprocesarlo con las herramientas de OSRM antes de poder servirlo.

Desde `infra/osrm/`:

```bash
mkdir -p data && cd data

# 1) Descargar el extracto de España desde Geofabrik (~1 GB).
#    NO lo descargues como parte de la CI ni del loop: es un archivo enorme.
curl -O https://download.geofabrik.de/europe/spain-latest.osm.pbf

# 2) Preprocesar con el perfil de coche (extract -> partition -> customize).
#    Usa el mismo algoritmo MLD que el `command` del docker-compose.
docker run -t --rm -v "${PWD}:/data" osrm/osrm-backend osrm-extract    -p /opt/car.lua /data/spain-latest.osm.pbf
docker run -t --rm -v "${PWD}:/data" osrm/osrm-backend osrm-partition   /data/spain-latest.osrm
docker run -t --rm -v "${PWD}:/data" osrm/osrm-backend osrm-customize    /data/spain-latest.osrm
```

Esto deja los archivos `spain-latest.osrm*` en `infra/osrm/data/`, que es lo que
monta el contenedor.

## Levantar el servicio

```bash
cd infra/osrm
docker compose up -d
```

Queda escuchando en `http://localhost:5000`. Comprobación rápida (Madrid → Barcelona):

```bash
curl "http://localhost:5000/route/v1/driving/-3.7038,40.4168;2.1734,41.3851?overview=false"
```

## Configuración del cliente

`dashboard/lib/osrm.js` lee la URL de:

- `NEXT_PUBLIC_OSRM_URL` (preferido; visible en el navegador), o
- `OSRM_URL`, o
- `http://localhost:5000` por defecto.

## Tests

Los tests **nunca** llaman a OSRM real: mockean `distanciaPorCarretera` (o el
`fetch` global). Ver `dashboard/lib/data.test.js`. No hace falta tener el
contenedor corriendo para que la CI pase.
