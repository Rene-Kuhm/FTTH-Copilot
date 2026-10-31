# ADR 0016 — Gobernanza de fuentes MIB con grados de confianza y niveles de soporte

**Estado:** Aceptada
**Fecha:** 2026-09-10 (Fase 1 del roadmap de fuentes)
**Documento de procedimiento:** `docs/procedimiento-fuentes-mibs.md`

## Contexto

Para entender una trampa SNMP de un fabricante hay que saber qué OID significa qué. Esa
información vive en MIBs del fabricante, en manuales, en implementaciones de otros
proyectos o en blogs. Cada una tiene un estatus legal y de calidad distinto.

Tres riesgos concretos:

1. **Propiedad intelectual.** Las MIBs propietarias no se pueden redistribuir en un repo
   público. El proyecto es open source y las contribuciones son públicas.
2. **Confianza.** Un OID publicado en un foro puede ser incorrecto. Un OID incorrecto en un
   catálogo produce diagnósticos falsos, que es la peor clase de bug en este producto.
3. **Confidencialidad.** Una captura real de un trap de producción contiene comunidades
   SNMP, IPs de clientes, identificadores de abonados y números de serie.

El proyecto necesita una gobernanza que permita pasos de investigación rápidos sin abrir la
puerta a datos inventados o secretos publicados.

## Decisión

Establecer una **gobernanza explícita de fuentes** con tres piezas: admisibilidad, grados
de confianza y niveles de soporte, más un proceso de retiro y reemplazo.

### Gate 1 — admisibilidad

Ningún OID, trampa o convención entra al catálogo sin: `source_id` único, grado de
confianza (A–E), modelos asignados, versión de firmware (o `unknown` explícito), fecha de
obtención y estado de licencia.

Para fuentes propietarias o con licencia restringida (`restricted` / `review-required`):

- **No** se redistribuyen archivos MIB propietarios en el repositorio.
- Se registra la URL oficial, el editor, la fecha de consulta, el hash SHA-256 local (si
  se obtuvo lícitamente) y **sólo los hechos mínimos observables**: OID, nombre de trampa,
  tipos de varbinds.

### Grados de confianza

| Grado | Naturaleza | Requisito |
|---|---|---|
| **A** | Estándar oficial (IETF/ITU-T/BBF) o portal oficial del fabricante con versión | Autosuficiente |
| **B** | MIB del fabricante en proyectos maduros (LibreNMS, Observium, Net-SNMP) | Verificar origen, revisión y licencia |
| **C** | Proyecto comunitario o herramienta con evidencia sobre hardware identificado | Exige una segunda fuente concordante |
| **D** | Manual espejo, blog, plantilla o script sin verificar | Sólo permite descubrimiento |
| **E** | Comentario en foro o fragmento no documentado | Hipótesis de investigación |

### Niveles de soporte

| Nivel | Denominación | Evidencia mínima | Uso permitido |
|---|---|---|---|
| **L0** | Detectado | Enterprise OID o `sysObjectID` | Inventario; sin interpretación |
| **L1** | Documentado | MIB o especificación oficial (A o 2×B) | Decodificación en observación |
| **L2** | Simulado | L1 + tests unitarios con datagramas binarios reales | Laboratorio y simulación offline |
| **L3** | Captura real | L2 + captura sanitizada aportada por un operador | Modo sombra en infraestructura real |
| **L4** | Certificado en campo | Generación, recepción e incidentes en red viva | Producción activa para ese modelo y firmware |

### Confidencialidad

Prohibido incluir credenciales SNMP (comunidades, usuarios USM, claves de autenticación o
cifrado), IPs privadas de producción, identificadores de abonados o seriales reales. Todo
fixture debe estar sanitizado o sintetizado.

El saneado es una herramienta del repo: `pnpm sanitize:snmp`
(`scripts/sanitize-snmp-capture.ts`), que redacta comunidades a `<REDACTED_COMMUNITY>`, mapea
IPs a rangos RFC 5737 (`192.0.2.x`, `198.51.100.x`) y enmascara seriales preservando el
prefijo de 4 caracteres del vendor.

### Verificación automática

La coherencia de `research/olt/<vendor>/` se verifica en CI:

- `pnpm check:sources` — valida `sources.yaml` y `compatibility.yaml` contra el schema y
  detecta drift de la matriz.
- `pnpm check:conflicts` — busca colisiones de OID, PEN que no coinciden y contradicciones
  semánticas entre vendors.
- `pnpm check:contribution` — valida la contribución: schema válido, fixture presente para
  L2+, test unitario del adapter y ausencia de comunidades en texto plano.
- `pnpm check:sources:health` — auditoría de la integridad de los links de las fuentes.

### Retiro y reemplazo

Una fuente caída se degrada: se busca un mirror (por ejemplo Internet Archive), se actualiza
la URL en `sources.yaml`, y si no hay respaldo ni segunda fuente, el grado baja a D o E y
el nivel de soporte cae a L0. Una MIB reemplazada **no borra** el registro previo: se
marca `status: deprecated` y se crea un `source_id` nuevo, de modo que el adapter pueda
distinguir por firmware.

## Consecuencias

### Buenas

- **La confianza es explícita y auditable**: cada OID del catálogo sabe de dónde salió y
  con qué grado.
- El sistema **no redistribuye material propietario**, lo que mantiene el repo publicable.
- Los **niveles de soporte** dan un lenguaje común entre quien aporta una fuente, quien
  escribe el adapter y quien decide activar un vendor en producción.
- La **sanitización es una herramienta, no una disciplina**: correr el saneador es un
  comando, no una revisión manual.
- El **gate de contribución en CI** impide que un adapter sin fuentes, sin fixture o con
  un test que falle llegue a `main`.
- El mecanismo de **degradación por fuente caída** evita que un link roto deje un vendor
  inacreditado sin avisar.
- La distinción **deprecado vs. nuevo** permite que un adapter elija el OID correcto según
  el firmware del equipo.

### Malas

- **El proceso es burocracia para una contribución chica**: un solo vendor nuevo exige
  `sources.yaml`, `compatibility.yaml`, fixture, test unitario, golden files y pasar cinco
  gates.
- Los grados y los niveles **son convenciones**, no los verifica ninguna herramienta: un
  "grado A" mal asignado pasa todos los checks.
- La **degradación de una fuente caída es manual**: si nadie la revisa, un vendor con grado
  A sigue figurando como A después de que su MIB desapareció.
- `pnpm check:sources:health` **necesita red** y es lento: con `--timeout=8000` y muchas
  fuentes, el job trimestral tarda. Tiene modo `--dry-run` y `OFFLINE_MODE=true` para el
  caso sin red.
- La sanitización **no garantiza el 100%**: un serial en un campo no contemplado por el
  saneador pasa intacto.
- Los MIBs que el producto **necesita** están, en su mayoría, en grado B o C, con lo que
  eso implica para la confianza del dato resultante.

### Abiertas

- La fuente `research/olt/<vendor>/sources.yaml` tiene un schema propio
  (`packages/monitoring/src/snmp/research/schema.ts`) que no está documentado en el
  procedimiento con un ejemplo completo por vendor.
- El nivel de soporte real de cada vendor no está publicado como una tabla generada a
  partir de `compatibility.yaml`; la matriz de compatibilidad
  (`docs/compatibility-matrix.md`) cubre parte de eso.
- No hay un owner por vendor: nadie está a cargo de reactualizar una fuente degradada.
