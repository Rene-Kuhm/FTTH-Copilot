# snmpsim agent of the virtual test bench.
#
# Serves the LibreNMS device captures downloaded into `docker/lab/captures/`
# (GPL-3.0, never committed; see `docker/lab/README.md`). snmpsim serves one
# capture per SNMP community and derives the community from the data file name:
# `smartax.snmprec` answers the `smartax` community.
#
# Pinned versions:
#   snmpsim 1.2.2 (lextudio) — the Python implementation LibreNMS tests against.
#   pysmi   2.0.0            — snmpsim imports it at startup but only declares it
#                              as a dev extra, so it is installed explicitly.
FROM python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54

# net-snmp tools: the container health check and manual debugging (snmpget,
# snmpwalk) run inside the bench instead of depending on host packages.
RUN apt-get update \
 && apt-get install -y --no-install-recommends snmp \
 && rm -rf /var/lib/apt/lists/*

ARG SNMPSIM_VERSION=1.2.2
ARG PYSMI_VERSION=2.0.0
RUN pip install --no-cache-dir "snmpsim==${SNMPSIM_VERSION}" "pysmi==${PYSMI_VERSION}"

# snmpsim refuses to run as root, and it listens on an unprivileged port inside
# the container: the host publishes it on 127.0.0.1.
RUN useradd --create-home --uid 10001 snmpsim
USER snmpsim
WORKDIR /home/snmpsim

ENV SNMPSIM_DATA_DIR=/snmpsim/data
EXPOSE 1161/udp

ENTRYPOINT ["snmpsim-command-responder"]
CMD ["--data-dir=/snmpsim/data", "--agent-udpv4-endpoint=0.0.0.0:1161", "--log-level=info"]
