# MikroTik CHR of the virtual test bench: real RouterOS in QEMU, on KVM.
#
# Upstream (`evilfreelancer/docker-routeros`) forwards a fixed list of QEMU
# user-net ports — SSH, telnet, HTTP, HTTPS, API, Winbox, VNC — and SNMP
# (161/udp) is not one of them. The bench needs SNMP on the loopback, so this
# patch adds that single forward. The `grep` makes the build fail if the
# upstream script ever stops matching, instead of shipping a container that
# silently answers nothing on 161/udp.
FROM evilfreelancer/docker-routeros:7.24.6@sha256:c6dd1ae4e98c8553c749a54747dd89c08a3b4cf396c8c4e8303829d7eec7c688

RUN sed -i 's|user,hostfwd=tcp::22-:22|user,hostfwd=udp::161-:161,hostfwd=tcp::22-:22|' \
      /routeros_source/entrypoint.sh \
 && grep -q 'hostfwd=udp::161-:161' /routeros_source/entrypoint.sh

# curl: the container health check authenticates against /rest and the bench is
# easier to debug by hand than through the QEMU console.
RUN apk add --no-cache curl
