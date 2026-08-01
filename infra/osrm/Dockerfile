# OSRM para PRODUCCIÓN — pensado para que Railway lo construya en su propia
# infraestructura (no requiere Docker local: Railway hace `docker build` por
# nosotros a partir de este Dockerfile). El extracto de España se descarga y
# preprocesa DENTRO del build, así no hay que versionar el .osm.pbf (~1 GB)
# ni depender de un paso manual con Docker local (ver README.md, "nunca se ha
# levantado ni probado contra un caso real" -- este Dockerfile es el primer
# intento de que se levante solo, sin depender de que alguien tenga Docker).
#
# ADVERTENCIA HONESTA (2026-07-28, no verificada): el preprocesado de España
# completo (osrm-extract + osrm-partition + osrm-customize) necesita RAM y
# tiempo de build considerables -- el plan gratuito/hobby de Railway puede no
# alcanzar. Si el build falla por memoria o timeout, la alternativa es
# preprocesar en una máquina con más RAM (o localmente con Docker) y subir
# los ficheros `.osrm*` ya procesados a un volumen persistente en vez de
# regenerarlos en cada build.

FROM ghcr.io/project-osrm/osrm-backend:latest AS builder

RUN apt-get update && apt-get install -y curl osmium-tool && rm -rf /var/lib/apt/lists/*

WORKDIR /data
RUN curl -fL -o spain-full.osm.pbf https://download.geofabrik.de/europe/spain-latest.osm.pbf

# Recorte a solo carreteras principales (autopista/nacional/comarcal) — sin calles
# residenciales, edificios ni POIs. El objetivo es solo calcular km/tiempo entre
# ciudades para camiones, no pintar un mapa detallado; esto reduce el fichero y la
# RAM necesaria en tiempo de ejecución (osrm-routed venía muriendo sin RAM con el
# extracto completo de España, ver ROADMAP.md).
RUN osmium tags-filter spain-full.osm.pbf \
    w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link \
    -o spain-latest.osm.pbf --overwrite && rm spain-full.osm.pbf

RUN osrm-extract -p /opt/car.lua spain-latest.osm.pbf
RUN osrm-contract spain-latest.osrm

FROM ghcr.io/project-osrm/osrm-backend:latest
COPY --from=builder /data /data
EXPOSE 5000
CMD ["osrm-routed", "--algorithm", "ch", "/data/spain-latest.osrm"]
