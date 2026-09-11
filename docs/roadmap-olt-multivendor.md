# Roadmap de compatibilidad OLT multi-fabricante

Este roadmap convierte el receptor SNMP de laboratorio en una plataforma de observación multi-fabricante basada en evidencia pública trazable. El objetivo es admitir las familias OLT más relevantes para operadores globales y regionales sin exigir hardware durante el desarrollo, dejando la certificación física como un nivel posterior y explícito.

## Ruta rápida

1. Corregir el receptor para decodificar datagramas SNMP reales.
2. Crear un registro de fuentes, licencias, modelos y firmware.
3. Implementar paquetes por fabricante, comenzando por Huawei, ZTE, Nokia y FiberHome.
4. Ampliar a Calix, Adtran, DZS, Zyxel, VSOL, C-Data, BDCOM y Ubiquiti.
5. Ejecutar un laboratorio reproducible con MIBs, paquetes binarios, `snmptrap` y escenarios adversariales.
6. Publicar compatibilidad por modelo y firmware con nivel documental, simulado o certificado en campo.

El trabajo termina sin hardware en el estado **Validado documentalmente y por simulación**. El estado **Certificado en campo** requiere una captura o prueba autorizada contra el modelo y firmware declarados.

## 1. Decisión y alcance

FTTH-Copilot mantendrá un núcleo SNMP independiente del fabricante y adaptadores de interpretación separados. Ningún OID comunitario entrará como hecho confirmado sin procedencia, y ningún trap desconocido producirá una causa o severidad inventada.

El alcance incluye:

- SNMP v1, v2c y v3 para recepción de traps e informs.
- Alarmas OLT, tarjeta, uplink, puerto PON y ONU/ONT.
- Identidad `tenant → connection → OLT → slot/PON → ONU`.
- Alarmas y sus eventos de recuperación.
- Huawei, ZTE, Nokia, FiberHome, Calix, Adtran, DZS, Zyxel, VSOL, C-Data, BDCOM y Ubiquiti.
- Investigación en documentación oficial y en fuentes públicas de terceros: GitHub, GitLab, LibreNMS, Observium, Zabbix, Netdata, repositorios de operadores, blogs técnicos, foros y espejos de manuales.

Quedan fuera del alcance inicial:

- Aprovisionamiento o cualquier operación SNMP `SET`.
- Declarar compatibilidad universal entre firmwares de un mismo fabricante.
- Incorporar al repositorio documentos o MIBs cuya licencia no permita redistribución.
- Convertir una observación comunitaria aislada en regla de producción.

## 2. Hallazgos de la investigación

### 2.1 Fabricantes que justifican cobertura

Los datos detallados de cuota por puertos PON son comerciales. Dell'Oro sí confirma que su seguimiento mundial separa envíos por fabricante y región, incluida CALA, y cubre GPON, XG-PON, XGS-PON, NG-PON2, 25G/50G PON y Combo PON.[^1] Como señal pública complementaria, Omdia situó conjuntamente a Huawei, ZTE y FiberHome en 71% del mercado PON de 2024; esta cifra sirve para priorizar investigación, no como inventario de instalaciones de FTTH-Copilot.[^2]

Las familias elegidas tienen plataformas PON vigentes o material técnico público verificable:

| Grupo | Fabricante | Familias objetivo | Evidencia de producto | Prioridad |
|---|---|---|---|---|
| Núcleo global | Huawei | MA5600/MA5680, MA5800/MA5801 | MA5800 admite GPON, XG(S)-PON y evolución a 50G PON.[^3] | P0 |
| Núcleo global | ZTE | C300/C320, C600/C650 | C600 ofrece tarjetas GPON, XG-PON, XGS-PON y Combo PON.[^4] | P0 |
| Núcleo global | Nokia | 7360 ISAM, Lightspan FX/MF/DF | Lightspan cubre GPON, XGS-PON, 25G PON y evolución superior.[^5] | P0 |
| Núcleo global | FiberHome | AN5516, AN6000/AN6001 | AN6000 cubre EPON, GPON, XG-PON y XGS-PON.[^6] | P0 |
| Operadores NA/Europa | Calix | E7, E9 | E9 dispone de GPON, XGS-PON y NG-PON2.[^7] | P1 |
| Operadores NA/Europa | Adtran | TA5000, SDX 6000 | SDX 6000 cubre GPON, XGS-PON, Combo PON y 10G-EPON.[^8] | P1 |
| Operadores regionales | DZS/Zhone | MXK, Velocity V1 | Velocity ofrece GPON, XGS-PON y Combo PON.[^9] | P1 |
| Operadores regionales | Zyxel | IES4204/IES5206/IES5212 | IES5206 admite GPON y XGS-PON.[^10] | P1 |
| ISP regional | VSOL | V1600, V3600 | El fabricante publica firmware para familias GPON, XG/XGS-PON y Combo.[^11] | P1 |
| ISP regional | C-Data | FD11xx/FD12xx, FD16xx/FD18xx | Su catálogo incluye EPON, GPON y XG(S)-PON.[^12] | P1 |
| ISP regional | BDCOM | P33xx/P36xx | Existen MIBs GPON públicas bajo el árbol empresarial 3320.[^13] | P2 |
| ISP regional | Ubiquiti | UF-OLT, UISP Fiber OLT XGS | UF-OLT y la nueva familia XGS están documentadas públicamente.[^14] | P2 |

La prioridad mide utilidad del adaptador y posibilidad de demostrarlo. No afirma un ranking exacto de ventas.

### 2.2 Fuentes públicas aprovechables

La información necesaria está dispersa. Hay MIBs de Huawei, Calix, Adtran, FiberHome y BDCOM en repositorios de monitorización; proyectos comunitarios contienen MIBs, índices y resultados de campo para ZTE C300/C320 y FiberHome AN5516.[^13][^15][^16][^17][^18] Estas fuentes son valiosas para descubrir y contrastar, pero su existencia pública no concede automáticamente derecho a redistribuir cada archivo.

Para Nokia, Calix y algunos firmwares recientes, parte de la documentación está detrás de soporte o marcada como propietaria. En esos casos se registrarán metadatos, hashes y hechos mínimos verificables, sin copiar el documento al repositorio.

### 2.3 Estado real del código actual

La base existente es útil, pero todavía no recibe traps reales de extremo a extremo:

| Superficie | Estado observado | Consecuencia |
|---|---|---|
| `packages/monitoring/src/snmp/catalog.ts` | Catálogo estático con traps estándar, Huawei, ZTE y FiberHome. | Buen punto de partida; faltan procedencia y variante por firmware. |
| `parser.ts` | Normaliza un objeto ya decodificado y detecta seriales con una expresión regular. | No interpreta índices `slot/PON/ONU` específicos de cada fabricante. |
| `apps/web/lib/monitoring/snmp.ts` | Recibe UDP, pero ignora los bytes y crea siempre un paquete v2c `linkDown`. | El receptor actual es un scaffold; no demuestra ingesta SNMP real. |
| Guardia de deduplicación | La firma del receptor es `IP:tamaño`. | Dos traps distintos del mismo tamaño pueden tratarse como duplicados. |
| SNMPv3 | El tipo lo admite, pero el receptor fuerza v2c y no valida USM. | No existe soporte operativo v3 todavía. |
| Evidencia cruda | El contrato de prueba promete conservar varbinds, pero el evento no los preserva. | No se puede reanalizar un trap desconocido con suficiente fidelidad. |

Por ello, añadir OIDs sin completar primero la Fase 0 aumentaría una compatibilidad aparente que no existe en el cable.

## 3. Modelo de compatibilidad

### 3.1 Arquitectura objetivo

```text
Datagrama UDP
    │
    ▼
Decoder SNMP v1/v2c/v3 ──► validación de tamaño y autenticación
    │
    ▼
Identidad del remitente ──► tenant / conexión / OLT / modelo / firmware
    │
    ▼
Envelope crudo inmutable ─► hash + OID + varbinds + tiempos
    │
    ▼
Adaptador de fabricante ──► Huawei / ZTE / Nokia / ...
    │
    ▼
Evento telemetry.v1 ──────► observación / alarma / recuperación
    │
    ▼
Correlación con incidente ─► sin acciones sobre la OLT
```

El decoder entiende el protocolo. El adaptador entiende la semántica del fabricante. El correlador nunca necesita conocer OIDs privados.

### 3.2 Paquete por fabricante

Cada adaptador deberá exponer:

```ts
interface OltVendorAdapter {
  vendor: string;
  supportedFamilies: readonly string[];
  identify(input: DeviceIdentityEvidence): MatchResult;
  decodeTrap(input: DecodedSnmpNotification): VendorTrapResult;
}
```

Cada resultado deberá diferenciar:

- `recognized`: OID y forma respaldados por fuentes suficientes.
- `provisional`: interpretación plausible que solo se almacena en observación.
- `unknown`: se conserva evidencia sin inferir categoría.
- `invalid`: contradicción de tipos, índices o forma esperada.

### 3.3 Niveles públicos de soporte

| Nivel | Nombre | Evidencia mínima | Uso permitido |
|---|---|---|---|
| L0 | Detectado | Enterprise OID o identidad de producto. | Inventario; sin interpretación. |
| L1 | Documentado | MIB/manual oficial o dos fuentes públicas independientes concordantes. | Decodificación en observación. |
| L2 | Simulado | L1 más paquetes binarios y pruebas de alarm/clear reproducibles. | Laboratorio y piloto offline. |
| L3 | Captura real | L2 más captura sanitizada aportada por operador para modelo/firmware. | Modo sombra con ese modelo. |
| L4 | Certificado en campo | Prueba autorizada de generación, recepción, identidad y recuperación. | Producción para esa combinación. |

La matriz pública nunca dirá simplemente “Huawei soportado”. Mostrará, por ejemplo, `Huawei MA5800 / firmware desconocido / L2`.

## 4. Política de investigación en Internet

### 4.1 Dónde buscar

La búsqueda debe recorrer, por orden de autoridad:

1. Portales y documentos del fabricante.
2. IETF, IANA, ITU-T y Broadband Forum para contratos estándar.
3. Repositorios maduros de monitorización: LibreNMS, Observium, Netdata, Zabbix y Telegraf.
4. GitHub y GitLab: MIBs, exporters, adaptadores, plantillas y capturas sanitizadas.
5. Repositorios de ISP, universidades, integradores y distribuidores.
6. Blogs técnicos y comunidades en español, portugués, inglés, indonesio y chino.
7. Espejos de manuales, foros y archivos históricos para descubrir pistas que luego deberán contrastarse.

Consultas base por familia:

```text
"<fabricante> <modelo>" MIB
"<fabricante> <modelo>" SNMP trap alarm manual
"<fabricante> <modelo>" snmpwalk OID
"<fabricante> <modelo>" dying gasp LOS clear
site:github.com "<modelo>" MIB
site:github.com "<enterprise OID>"
"<modelo>" Zabbix template OR LibreNMS OR Observium
"<modelo>" MIB 告警
"<modelo>" SNMP OID monitoramento
```

### 4.2 Jerarquía de confianza

| Grado | Fuente | Regla |
|---|---|---|
| A | Estándar o fabricante oficial, con versión. | Puede sostener una definición por sí sola. |
| B | MIB del fabricante publicada en un proyecto reconocido. | Requiere comprobar origen, revisión y licencia. |
| C | Proyecto con evidencia de uso sobre hardware identificado. | Requiere una segunda fuente independiente. |
| D | Manual espejo, blog técnico o plantilla comunitaria. | Sirve para descubrir; no habilita alertas por sí sola. |
| E | Foro, comentario o fragmento sin procedencia. | Solo hipótesis de búsqueda. |

Conflictos entre fuentes se resuelven a favor de la variante más específica por modelo y firmware. Si no se pueden resolver, ambas formas permanecen separadas y provisionales.

### 4.3 Registro obligatorio de fuentes

Cada hallazgo tendrá un registro versionado:

```yaml
source_id: huawei-ma5800-gpon-alarm-001
vendor: Huawei
families: [MA5800]
firmware: unknown
title: HUAWEI-GPON-MIB
publisher: Huawei
url: https://example.invalid/source
source_grade: B
retrieved_at: 2026-09-10
license: review-required
sha256: null
facts:
  - notification_name: exampleAlarm
    oid: 1.3.6.1.4.1.example
    status: provisional
```

No se incluirán secretos, comunidades SNMP, direcciones privadas, seriales de clientes ni documentos con prohibición de redistribución. Para material no redistribuible se guardará el enlace, descripción, fecha, hash local si fue lícitamente obtenido y una transcripción mínima de hechos; no el archivo.

## 5. Taxonomía canónica de eventos

El catálogo se ampliará con categorías independientes del fabricante:

| Dominio | Categorías iniciales |
|---|---|
| Sistema | `cold_start`, `warm_start`, `control_failover`, `clock_fault` |
| Energía | `power_failure`, `dying_gasp`, `rectifier_alarm`, `battery_alarm` |
| Ambiente | `temperature_high`, `fan_failure`, `door_open`, `smoke_alarm` |
| Tarjeta | `board_missing`, `board_fault`, `board_restart`, `version_mismatch` |
| Uplink | `link_down`, `link_up`, `lag_degraded` |
| PON | `pon_los`, `pon_down`, `pon_up`, `laser_fault`, `optical_threshold` |
| ONU | `onu_los`, `onu_dying_gasp`, `onu_offline`, `onu_online`, `onu_flapping` |
| Calidad | `fec_threshold`, `ber_threshold`, `rx_low`, `tx_abnormal` |
| Seguridad | `authentication_failure`, `configuration_change` |
| Desconocido | `unknown_trap`, `unsupported_shape`, `ambiguous_identity` |

Cada alarma debe declarar si existe un evento `clear`, qué clave forma su identidad y cuáles son sus límites. `dying_gasp` describe una señal reportada por la ONU; no prueba por sí solo la causa física definitiva.

## 6. Plan de entrega

Cada fase comienza con un cambio OpenSpec y termina con pruebas ejecutadas, informe de verificación y archivo del cambio. Los PR deben ser pequeños y mantener el receptor desactivado por defecto.

### Fase 0 — Receptor SNMP real y evidencia cruda (Verificada en PR #145)

Objetivo: sustituir el scaffold por una ruta binaria comprobable.

- [x] Elegir una biblioteca SNMP mantenida o justificar un decoder acotado; registrar versiones, límites y CVE relevantes (`net-snmp` v3.26.3).
- [x] Decodificar PDU v1, TrapV2 e Inform desde los bytes UDP reales.
- [x] Responder correctamente a Inform cuando el protocolo lo requiera.
- [x] Separar `eventTime`, `sysUpTime` y `receivedAt`.
- [x] Preservar OID, tipos y valores de varbinds en un envelope acotado y redactado.
- [x] Reemplazar la deduplicación `IP:tamaño` por una huella de remitente, versión, request ID, OID y varbinds canónicos.
- [x] Validar community v2c sin exponerla; implementar USM SNMPv3 `authPriv` conforme a RFC 3414.[^19]
- [x] Mantener v1/v2c disponibles por compatibilidad, con advertencia y segmentación de red.
- [x] Probar paquetes truncados, ASN.1 inválido, payload máximo, flood, replay y remitente desconocido.
- [x] Agregar `pnpm test:snmp` para enviar traps con Net-SNMP; `snmptrap` soporta v1, v2c, v3 y varbinds tipados.[^20]

Gate 0:

- [x] Un datagrama generado externamente llega al callback con su OID y varbinds reales.
- [x] Dos traps distintos con el mismo tamaño no colisionan.
- [x] Un trap desconocido conserva evidencia y no crea diagnóstico.
- [x] Las pruebas de v1, v2c, v3, TrapV2 e Inform pasan en CI.

### Fase 1 — Registro de fuentes y herramientas MIB

Objetivo: hacer auditable cada OID antes de ampliar el catálogo.

- [x] Crear `research/olt/<vendor>/sources.yaml`, `compatibility.yaml` y `fixtures/`.
- [x] Definir schemas para fuente, modelo, firmware, trap, varbind e identidad.
- [x] Implementar validación de URLs, duplicados, Enterprise OID y estado de licencia.
- [x] Añadir compilación aislada de MIBs mediante `snmptranslate` sin requerir redistribuirlas.
- [x] Registrar IANA Private Enterprise Numbers como raíz, evitando identificar fabricante por texto libre.[^21]
- [x] Crear un comando que genere la matriz de compatibilidad desde datos, sin editar tablas a mano.
- [x] Documentar cómo reportar una fuente retirada o una MIB reemplazada.

Gate 1:
- [x] Ninguna definición entra al catálogo sin `source_id`, grado, modelos, firmware conocido o explícitamente desconocido y estado de licencia. Verificado en PR #147 y archivado en `openspec/changes/archive/2026-09-10-fase-1-research-sources-and-mib-tools/`.

### Fase 2 — Base estándar y contrato de adaptadores

Objetivo: fijar comportamiento común antes de variantes privadas.

- [x] Cubrir SNMPv2-MIB, IF-MIB, SNMP-FRAMEWORK-MIB, ENTITY-MIB y NOTIFICATION-LOG-MIB cuando apliquen.
- [x] Mapear `coldStart`, `warmStart`, `linkDown`, `linkUp` y autenticación fallida.
- [x] Definir identificación por Enterprise OID, `sysObjectID` y contexto registrado.
- [x] Crear contrato `OltVendorAdapter` y registro determinista de adaptadores.
- [x] Rechazar ambigüedad cuando dos fabricantes o clones compartan árboles parecidos.
- [x] Probar que los adaptadores no pueden cambiar tenant, ejecutar comandos ni elevar severidad sin fuente.

Gate 2:
- [x] Los traps estándar atraviesan decoder, identidad, envelope, adaptador y `telemetry.v1` con pruebas binarias. Verificado en PR #149 y archivado en `openspec/changes/archive/2026-09-10-fase-2-standard-traps-and-adapter-contract/`.

### Fase 3 — Huawei y ZTE

Objetivo: cubrir primero las familias con mayor prioridad global y abundante material público.

- [x] Investigar MA5600/MA5680 y MA5800/MA5801 por separado.
- [x] Investigar ZXA10 C300/C320 y C600/C650 por separado.
- [x] Contrastar MIBs oficiales o espejadas con repositorios de Huawei y proyectos ZTE usados en monitorización.[^15][^16]
- [x] Implementar identidad de frame/slot/port/ONU y serial por familia.
- [x] Cubrir ONU LOS, dying gasp, offline/online, PON down/up, tarjeta, energía y temperatura cuando la fuente lo sostenga.
- [x] Crear pares alarm/clear y variantes por firmware.
- [x] Rebajar a provisional los OIDs actuales que no puedan trazarse.

Gate 3:
- [x] Huawei y ZTE alcanzan L2 para al menos una familia cada uno; todas las definiciones actuales quedan confirmadas, corregidas o retiradas. Verificado en `openspec/changes/2026-09-10-fase-3-huawei-zte-adapters/verify-report.md`.

### Fase 4 — Nokia y FiberHome

Objetivo: completar el núcleo global.

- [x] Investigar Nokia 7360 ISAM y Lightspan como perfiles separados.
- [x] Catalogar ASAM-SYSTEM, ASAM-EQUIP y ASAM-ALARM cuando sean obtenibles y redistribuibles.
- [x] Investigar FiberHome AN5516 y AN6000 por separado; no trasladar automáticamente índices entre generaciones.
- [x] Contrastar el manual MIB de AN6000 con `snmp-fiberhome`, LibreNMS y capturas públicas.[^6][^17][^18]
- [x] Cubrir identidad ONU, LOS, dying gasp, estado PON, tarjeta, energía y recuperación.
- [x] Documentar huecos donde Nokia requiera acceso de soporte.

Gate 4:
- [x] Nokia y FiberHome alcanzan L2 para 7360-ISAM-FX, Lightspan-MF, AN5516 y AN6000 con pruebas simuladas y suites unitarias/e2e. Verificado en `openspec/changes/2026-09-10-fase-4-nokia-fiberhome-adapters/verify-report.md`.

### Fase 5 — Calix, Adtran, DZS y Zyxel

Objetivo: cubrir operadores de Norteamérica y Europa y proveedores alternativos.

- [x] Separar Calix E7 de E9/AXOS; no asumir MIB común.
- [x] Contrastar E7-Calix-MIB y convenciones de alarmas públicas.[^22]
- [x] Separar Adtran TA5000 de SDX/Mosaic; investigar MIBs de tarjeta, PON y alarmas.[^23]
- [x] Investigar DZS MXK y Velocity V1.
- [x] Investigar Zyxel IES por generación.
- [x] Implementar solo traps cuya identidad de objeto sea recuperable de forma determinista.

Gate 5:
- [x] Cada fabricante tiene inventario de fuentes y al menos L1; Calix y Adtran alcanzan L2 con suites unitarias, simulación y pruebas UDP loopback. Verificado en `openspec/changes/2026-09-10-fase-5-calix-adtran-dzs-zyxel-adapters/verify-report.md`.

### Fase 6 — VSOL, C-Data, BDCOM y Ubiquiti

Objetivo: cubrir equipos frecuentes en ISP pequeños y regionales.

- [x] Separar GPON, EPON, XGS-PON y Combo; estos equipos pueden usar árboles distintos dentro de una misma marca.
- [x] Investigar VSOL V1600/V3600 por firmware publicado.[^11]
- [x] Investigar C-Data FD por Enterprise OID y chipset, evitando identificar clones solo por marca comercial.[^12]
- [x] Contrastar BDCOM con NMS-GPON-MIB y evidencia pública de campo.[^13]
- [x] Investigar UF-OLT y UISP Fiber OLT XGS; registrar cuándo la gestión se expone por UISP y cuándo por SNMP.[^14]
- [x] Añadir un perfil `generic_xpon` que conserve traps desconocidos sin pretender compatibilidad.

Gate 6:
- [x] Los cuatro fabricantes tienen inventario; VSOL y BDCOM alcanzan L2 con suites unitarias, simulación y pruebas UDP loopback, y C-Data y Ubiquiti publican sus restricciones y límites arquitectónicos verificables (UISP vs SNMP y white-label OEM). Verificado en `openspec/changes/2026-09-10-fase-6-vsol-cdata-bdcom-ubiquiti-adapters/verify-report.md`.

### Fase 7 — Laboratorio de conformidad sin hardware

Objetivo: hacer repetible la validación para cualquier contribuidor.

- [x] Crear contenedor Net-SNMP con MIBDIR aislado.
- [x] Generar paquetes binarios v1/v2c/v3 desde fixtures y reproducirlos sobre UDP.
- [x] Mantener golden files del envelope crudo y del evento normalizado.
- [x] Probar alarm/clear, duplicado, replay, reorder, clock skew y storm.
- [x] Añadir property tests para ASN.1 y varbinds sin datos sensibles.
- [x] Ejecutar pruebas de aislamiento entre tenants y remitentes con IP compartida detrás de relay.
- [x] Medir eventos/segundo, memoria, drops y latencia p95 antes de considerar un proceso separado.
- [x] Publicar artefactos y matriz de resultados desde CI.

Gate 7:
- [x] Cualquier adaptador L2 puede reconstruirse desde cero con fuentes permitidas y aprobar la misma suite de conformidad sin hardware físico. Verificado en `openspec/changes/2026-09-10-fase-7-hardwareless-conformance-lab/verify-report.md`.

### Fase 8 — Comunidad, mantenimiento y publicación

Objetivo: permitir que operadores amplíen compatibilidad sin debilitar la evidencia.

- [ ] Crear plantilla de contribución para MIB, manual, `snmpwalk` o captura sanitizada.
- [ ] Añadir sanitizador que elimine community, IP, hostname, serial y datos de cliente.
- [ ] Exigir modelo, firmware, fuente, licencia y reproducción mínima en cada PR.
- [ ] Automatizar detección de OIDs duplicados y conflictos semánticos.
- [ ] Publicar tabla generada por modelo/firmware/nivel.
- [ ] Programar revisión trimestral de enlaces rotos, firmwares y fuentes reemplazadas.
- [ ] Mantener un registro de erratas y retirar reglas que produzcan falsos positivos.

Gate 8: una contribución externa puede pasar desde captura sanitizada hasta L2 sin acceso al entorno del operador.

### Fase 9 — Certificación de campo diferida

Objetivo: convertir L2 en L3/L4 cuando aparezca acceso legítimo a hardware.

- [ ] Obtener autorización del propietario del equipo y ventana de prueba.
- [ ] Registrar modelo, tarjetas, firmware, versión SNMP y configuración relevante.
- [ ] Capturar alarma y recuperación controladas sin ejecutar remediación.
- [ ] Comparar bytes, varbinds, tiempos e identidad con fixtures.
- [ ] Ejecutar modo sombra y revisar falsos positivos antes de alertar.
- [ ] Firmar informe por combinación modelo/firmware.

Gate 9: solo la combinación probada asciende a L4. Las demás conservan su nivel anterior.

## 7. Orden de PR recomendado

| PR | Unidad revisable | Dependencia |
|---|---|---|
| 1 | Decoder binario y envelope crudo | Ninguna |
| 2 | Deduplicación, seguridad v3 e Inform | PR 1 |
| 3 | Registro de fuentes y schema de compatibilidad | PR 1 |
| 4 | Adaptador estándar y harness Net-SNMP | PR 1–3 |
| 5–6 | Huawei y ZTE | PR 4 |
| 7–8 | Nokia y FiberHome | PR 4 |
| 9–10 | Calix, Adtran, DZS y Zyxel | PR 4 |
| 11–12 | VSOL, C-Data, BDCOM y Ubiquiti | PR 4 |
| 13 | Matriz generada, sanitizador y contribuciones | Adaptadores L2 |
| 14 | Informe de laboratorio y cierre | Todos los anteriores |

Si un PR supera unas 400 líneas de lógica revisable, se dividirá por contrato, fabricante o fixtures. MIBs voluminosas no deben ocultar cambios de código en el mismo diff.

## 8. Verificación obligatoria

Cada adaptador deberá demostrar:

- [ ] Identificación correcta y rechazo de modelo ambiguo.
- [ ] Decodificación de OID y tipos ASN.1.
- [ ] Extracción determinista de OLT, tarjeta, PON y ONU cuando la fuente lo permita.
- [ ] Separación entre alarma y recuperación.
- [ ] Conservación de evidencia desconocida.
- [ ] Cero confianza en tenant o identidad incluidos en el payload.
- [ ] Cero operaciones de escritura hacia la OLT.
- [ ] Redacción de secretos y datos del operador.
- [ ] Límites de tamaño, tasa, cola y retención.
- [ ] Prueba runtime de datagrama a `telemetry.v1`.
- [ ] CI del SHA exacto aprobado.
- [ ] Matriz de compatibilidad regenerada y sin diferencias inesperadas.

## 9. Riesgos y controles

| Riesgo | Control |
|---|---|
| OID correcto con semántica incorrecta | Fuente por firmware y pares alarm/clear. |
| Manual público pero propietario | Registrar enlace y hechos; no redistribuir el archivo. |
| MIB antigua aplicada a hardware nuevo | Compatibilidad por familia y firmware, nunca solo por marca. |
| Clones con Enterprise OID compartido | Identificación compuesta y estado ambiguo seguro. |
| Community expuesta en fixtures | Sanitizador y secret scanning. |
| SNMPv2c sin autenticación fuerte | Red de gestión, allowlist y preferencia v3 `authPriv`. |
| Trap UDP perdido o reordenado | Correlación tolerante, polling de reconciliación y métricas de drops. |
| Fuente comunitaria equivocada | Grados de confianza y segunda fuente obligatoria. |
| Falso “soportado” sin hardware | Niveles L0–L4 visibles al usuario. |
| Catálogo inmantenible | Datos versionados, generación automática y adaptadores aislados. |

## 10. Criterio de finalización

El roadmap de laboratorio estará completo cuando:

- El receptor procese bytes SNMP reales y SNMPv3.
- Los 12 fabricantes tengan inventario de fuentes y modelos.
- Huawei, ZTE, Nokia y FiberHome alcancen L2, salvo bloqueo documentado específico.
- Al menos cuatro fabricantes de los grupos P1/P2 alcancen L2.
- La matriz pública se genere desde datos versionados.
- Todos los OIDs actuales tengan procedencia o hayan sido retirados.
- El laboratorio pueda reproducirse en CI sin hardware.
- No existan cambios OpenSpec activos sin cerrar.

La falta de hardware no bloquea este cierre. Sí impide declarar L4 o cerrar el Gate de campo para una combinación concreta.

## 11. Próxima sesión

Ejecutar solamente la Fase 0. Abrir el cambio OpenSpec para el decoder SNMP real, capturar como prueba un datagrama generado por `snmptrap`, reemplazar la firma de deduplicación y conservar evidencia cruda acotada. No ampliar el catálogo de fabricantes hasta que ese recorrido binario pase en CI.

## Fuentes

[^1]: Dell'Oro Group, [Broadband Access & Home Networking](https://www.delloro.com/market-research/telecommunications-infrastructure/broadband-access/), cobertura de mercado y envíos PON por región.
[^2]: Light Reading, [Huawei bans leave fiber operators with little choice besides Nokia](https://www.lightreading.com/fttx/huawei-bans-leave-fiber-operators-with-little-choice-besides-nokia), datos Omdia sobre participación PON 2024.
[^3]: Huawei, [SmartAX MA5800 Series OLT](https://e.huawei.com/eu/products/optical-access/ma5800).
[^4]: ZTE, [ZXA10 C600 Large-Capacity PON OLT](https://www.zte.com.cn/global/home_and_enterprise/campus_network/zxa10_c600.html).
[^5]: Nokia, [Broadband access networks](https://www.nokia.com/broadband-access/).
[^6]: FiberHome, [AN6000 Series OLT](https://www.fiberhome.com/OLTAN6000xl/20230110/42575.html).
[^7]: Calix, [AXOS E9-2 Intelligent Access Appliance](https://www.calix.com/products/platform/intelligent-access/systems/axos-e9-2.html).
[^8]: Adtran, [SDX 6000 Series](https://www.adtran.com/en/products-and-services/sdx-6000-series).
[^9]: DZS, [Fiber Access — Velocity OLT portfolio](https://dzsi.com/products-and-services/access-edge/fiber-access/).
[^10]: Zyxel, [IES5206 Series OLT](https://www.zyxel.com/service-provider/emea/en/products/fiber-oltsonts/xgs-pon/olts/ies5206-series).
[^11]: VSOL, [OLT firmware downloads](https://www.vsolcn.com/downloads/olt).
[^12]: C-Data, [OLT product portfolio](https://www.cdatatec.com/products/).
[^13]: LibreNMS, [BDCOM NMS-GPON-MIB](https://github.com/librenms/librenms/blob/master/mibs/bdcom/NMS-GPON-MIB).
[^14]: Ubiquiti, [UISP Fiber product families](https://techspecs.ui.com/uisp/fiber).
[^15]: Jeremias0618, [Huawei OLT/ONT SNMP MIBs](https://github.com/Jeremias0618/Huawei-OLT-ONT-SNMP-MIBs), colección comunitaria para MA5600T/MA5603T/MA5608T.
[^16]: didikw, [ZTE C320 monitoring](https://github.com/didikw/zte_c320_monitoring), MIBs, manuales y configuración de monitorización comunitaria.
[^17]: tqandrade, [snmp-fiberhome](https://github.com/tqandrade/snmp-fiberhome), implementación comunitaria probada con AN5516-01/06.
[^18]: LibreNMS, [FiberHome OLT Common MIB](https://github.com/librenms/librenms-mibs/blob/master/FIBERHOME-OLT-COMMON-MIB).
[^19]: IETF, [RFC 3414 — User-based Security Model for SNMPv3](https://datatracker.ietf.org/doc/rfc3414/).
[^20]: Net-SNMP, [Command tutorial](https://www.net-snmp.org/tutorial/tutorial-5/commands/index.html) y [snmptrap manual](https://netsnmp.org/man/snmptrap.html).
[^21]: IANA, [Private Enterprise Numbers](https://www.iana.org/assignments/enterprise-numbers/).
[^22]: LibreNMS, [Calix E7 MIB](https://github.com/librenms/librenms/blob/master/mibs/calix/E7-Calix-MIB).
[^23]: LibreNMS, [Adtran textual conventions and TA5000 identifiers](https://github.com/librenms/librenms/blob/master/mibs/adtran/ADTRAN-TC).
