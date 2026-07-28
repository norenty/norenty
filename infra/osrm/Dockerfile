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

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /data
RUN curl -O https://download.geofabrik.de/europe/spain-latest.osm.pbf
RUN osrm-extract -p /opt/car.lua spain-latest.osm.pbf
RUN osrm-partition spain-latest.osrm
RUN osrm-customize spain-latest.osrm

FROM ghcr.io/project-osrm/osrm-backend:latest
COPY --from=builder /data /data
EXPOSE 5000
CMD ["osrm-routed", "--algorithm", "mld", "/data/spain-latest.osrm"]
