# Banco de pruebas virtual (Docker Compose)

Tres endpoints de protocolo reales, sin hardware, levantados con un solo comando
desde la raíz del repo:

```bash
pnpm lab:up      # descarga las capturas y levanta/provisiona el banco
pnpm lab:check   # PASS/FAIL de los tres servicios
pnpm lab:down    # lo baja
```

Este archivo registra **qué corre, de dónde sale y qué no prueba**. El recorrido
de uso está en [`docs/testing-without-hardware.md`](../../docs/testing-without-hardware.md).

## Qué corre

| Servicio | Imagen (pinneada) | Puerto en 127.0.0.1 | Qué prueba |
|---|---|---|---|
| `bbsim` | `voltha/bbsim:2.16.0` @ `sha256:d158d42a2cfdd83877042c79875627a7f2c79616ce9402fb76a0aa7ecedb23d6` (Apache-2.0, [opencord/bbsim](https://github.com/opencord/bbsim)) | `15060/tcp` OpenOLT gRPC · `15071/tcp` REST | Un OLT emulado con 4 puertos PON XGS-PON y 2 ONUs por puerto: el plano de control OpenOLT/OMCI y las alarmas de ONU/OLT por REST |
| `snmpsim` | `python:3.12-slim` @ `sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54` + `snmpsim==1.2.2` + `pysmi==2.0.0` (BSD-2-Clause) | `16100/udp` | Que el poller lea **OIDs reales de cada fabricante** sobre capturas de equipos reales |
| `chr` | `evilfreelancer/docker-routeros:7.24.6` @ `sha256:c6dd1ae4e98c8553c749a54747dd89c08a3b4cf396c8c4e8303829d7eec7c688` (RouterOS CHR 7.24.6) | `15080/tcp` REST · `16101/udp` SNMP | Que el conector MikroTik hable `/rest` y SNMP contra un RouterOS de verdad |

Todos los puertos se publican en `127.0.0.1`. Ninguno choca con el stack de demo
(`3001`, syslog `15514`/`15515`).

El CHR necesita `/dev/kvm`. Sin KVM, QEMU cae a emulación y el invitado tarda
minutos en contestar: el health check falla en vez de quedarse colgado.

## Capturas SNMP: origen, commit y licencia

Las capturas **no viven en este repositorio**. Son caminatas reales de equipos,
tomadas del repositorio de LibreNMS:

| Dato | Valor |
|---|---|
| Repositorio | `https://github.com/librenms/librenms` |
| Ruta | `tests/snmpsim/*.snmprec` |
| Commit pinneado | `1c22ea7cae6eebb3856c281effd6eb64cf4bf53a` |
| URL de descarga | `https://raw.githubusercontent.com/librenms/librenms/1c22ea7cae6eebb3856c281effd6eb64cf4bf53a/tests/snmpsim/<archivo>` |
| Licencia | **GPL-3.0** |
| Dónde se descargan | `docker/lab/captures/` (ignorado por `.gitignore`) |

`pnpm lab:up` ejecuta `scripts/lab/fetch-captures.ts`, que baja cada archivo del
commit fijo, acepta texto plano o binario genérico de hasta 16 MiB, verifica que tenga `sysDescr` (`1.3.6.1.2.1.1.1.0`) y lo escribe de
forma atómica. `pnpm lab:check` verifica contra ese mismo archivo, así que no hay
valores esperados escritos a mano que puedan desincronizarse.

Por qué no se copian al repo: son GPL-3.0 y este repositorio es propietario.
Descargarlas al correr el banco mantiene el árbol limpio de código de terceros.

| Archivo | Comunidad SNMP | Fabricante | Equipo |
|---|---|---|---|
| `smartax.snmprec` | `smartax` | Huawei | SmartAX MA5800 |
| `smartax-mdu.snmprec` | `smartax-mdu` | Huawei | SmartAX MDU |
| `zxa10.snmprec` | `zxa10` | ZTE | ZXA10 C320 (captura corta) |
| `zxa10_c320.snmprec` | `zxa10_c320` | ZTE | ZXA10 C320 |
| `zxa10_c600.snmprec` | `zxa10_c600` | ZTE | ZXA10 C600 |
| `fiberhome_an5516-01.snmprec` | `fiberhome_an5516-01` | FiberHome | AN5516-01 |
| `fiberhome_an5516-04.snmprec` | `fiberhome_an5516-04` | FiberHome | AN5516-04 |
| `fiberhome_an5516-04b.snmprec` | `fiberhome_an5516-04b` | FiberHome | AN5516-04B |
| `fiberhome_an5516-06.snmprec` | `fiberhome_an5516-06` | FiberHome | AN5516-06 |
| `vsolution_v1600d.snmprec` | `vsolution_v1600d` | V-SOL | V1600D |

La convención es la de snmpsim: **el nombre del archivo sin `.snmprec` es la
comunidad**. Para consultar una captura:

```bash
docker compose -f docker-compose.lab.yml exec snmpsim \
  snmpget -v2c -c zxa10_c600 -Oqv 127.0.0.1:1161 1.3.6.1.2.1.1.1.0
```

## Credenciales (solo laboratorio)

| Qué | Valor |
|---|---|
| CHR / REST | `admin` / `ftth-lab-not-prod` (`LAB_CHR_ADMIN_USER` y `LAB_CHR_ADMIN_PASSWORD` lo cambian) |
| CHR / comunidad SNMP | `ftthlab` (solo lectura) |
| snmpsim | una comunidad por captura, ver la tabla de arriba |

Ninguna de estas credenciales es productiva ni se reutiliza en la aplicación. El
CHR arranca de fábrica con `admin` sin contraseña: `scripts/lab/chr-bootstrap.ts`
la fija antes de que el banco se declare listo, y el health check del contenedor
solo pasa autenticando con ella.

## Qué NO prueba

- **Potencia óptica en dBm.** BBSim modela el plano de control (OpenOLT, OMCI,
  alarmas), no la óptica: no hay RX power ni bias current que degradar.
- **Capturas estáticas.** Un `.snmprec` es una caminata fija; los valores no
  cambian salvo que se cargue un módulo de variación de snmpsim. Sirven para
  probar la lectura de OIDs reales, no una tendencia.
- **Nivel L3.** Este banco es "L2+ con capturas reales reproducidas", no el L3
  (equipo físico en staging) definido en
  [`docs/compatibility-matrix.md`](../../docs/compatibility-matrix.md).
- **Topología de acceso.** El CHR es un router solo: sin OLT, sin abonados PPPoE
  y sin tráfico.

## Depuración

```bash
docker compose -f docker-compose.lab.yml ps
docker compose -f docker-compose.lab.yml logs -f chr
docker compose -f docker-compose.lab.yml exec chr curl -su admin:ftth-lab-not-prod \
  http://127.0.0.1/rest/system/resource
```

El CHR mantiene el disco de RouterOS dentro del contenedor: `pnpm lab:down` lo
descarta y el siguiente `pnpm lab:up` vuelve a provisionar el invitado.
