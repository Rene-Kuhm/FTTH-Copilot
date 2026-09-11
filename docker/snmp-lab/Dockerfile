# Net-SNMP Isolated Conformance Lab
# Used for hardwareless OLT multi-vendor validation with isolated MIBDIR
FROM alpine:3.20

# Install Net-SNMP utilities and required tools
RUN apk add --no-cache \
    bash \
    curl \
    jq \
    coreutils \
    net-snmp-tools \
    net-snmp

# Isolate MIB directory to prevent pollution from host/standard distro paths
ENV MIBDIRS=/opt/snmp-lab/mibs
ENV MIBS=ALL

WORKDIR /workspace

# Create isolated MIB directory
RUN mkdir -p /opt/snmp-lab/mibs

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["help"]
