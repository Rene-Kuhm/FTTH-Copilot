# ADR 0008 — Adapters SNMP con identidad de vendor anclada en IANA PEN

**Estado:** Aceptada
**Fecha:** 2026-09-05 en adelante (Fase 2–5 del roadmap multi-vendor)
**Documento relacionado:** `docs/procedimiento-fuentes-mibs.md`

## Contexto

El producto tiene que entender trampas SNMP de fabricantes que no se hablan entre sí.
Huawei, ZTE, Nokia, FiberHome, Calix, Adtran, VSOL, BDCOM, DZS, Ubiquiti y el estándar
RFC 1157 tienen cada uno su propio árbol de OIDs, sus propias convenciones de varbinds y
sus propios prefijos de la raíz enterprise.

Las trampas llegan **sin etiqueta de vendor**: un datagrama UDP con un OID y varbinds. La
identidad hay que deducirla.

La tentación es identificarlas por el texto del mensaje o por la forma del OID. Ambas
fallan: los mensajes se traducen o se reescriben, y las formas de OID se solapan entre
familias.

El riesgo es peor que un dato incorrecto: un adapter que normaliza la trampa de un vendor
como si fuera de otro produce **diagnósticos falsos con apariencia de dato bueno**, que el
TruthGate no puede detectar porque el envelope se construye igual.

## Decisión

Anclar la **identidad de vendor en el IANA Private Enterprise Number (PEN)**, y hacer que
la normalización sea una operación pura y acotada por adapter.

- El registro es `IANA_VENDOR_REGISTRY`, un objeto **congelado** con `Object.freeze`
  (`packages/monitoring/src/snmp/iana-pen.ts:20`), con las raíces canónicas
  `IANA_ENTERPRISE_ROOT = '1.3.6.1.4.1'`, `STANDARD_MIB2_ROOT` y `SNMP_FRAMEWORK_ROOT`
  (`:17-19`). La resolución es `resolveVendorByPen` (`:134`).
- El contrato de adapter es `OltVendorAdapter`
  (`packages/monitoring/src/snmp/adapter/contract.ts:18-37`): `vendorId`, `supportedPens`,
  `supportedFamilies`, `supports()` y un `normalize()` **puro**.
- La resolución es determinista y con precedencia explícita
  (`packages/monitoring/src/snmp/adapter/registry.ts:28`): identidad ambigua ⇒ adapter
  estándar; match exacto de vendor-ID **más** `supports()`; match de PEN más `supports()`;
  y por último el fallback estándar (`registry.ts:66-90`).
- **El orden de registro importa**: `OpenBaselineOltAdapter` se registra **antes** que
  `GenericXponAdapter`, "para que las plataformas con un MIB público de alarmas conserven su
  interpretación específica de vendor" (`registry.ts:105-107`).
- `executeAdapterSafe` (`contract.ts:49`) es el arnés de seguridad: exige **inmutabilidad
  del tenant** (`:62`) y **rechaza la inflación de severidad injustificada** (`:76`),
  lanzando `AdapterSecurityViolationError` (`:39`).
- La pipeline completa es `processSnmpNotification`
  (`packages/monitoring/src/snmp/pipeline.ts:39`): identidad → adapter → normalización
  segura → evaluación de erratas (supresión y remapeo) → telemetría (`:53-100`).
- La identidad se resuelve multi-fuente con `resolveDeviceIdentity`
  (`packages/monitoring/src/snmp/identity.ts:36`).

## Consecuencias

### Buenas

- **La identidad es objective y verificable.** El PEN es un número asignado por IANA, no
  una heurística: el mismo trap se clasifica igual en cualquier instalación.
- `Object.freeze` sobre el registro hace que una mutación accidental en runtime sea un
  error visible en desarrollo en vez de una corrupción silenciosa.
- La precedencia de resolución es una **tabla explícita**: cuando dos adapters podrían
  aplicar, el comportamiento está documentado y no depende del orden de iteración.
- `normalize()` puro significa que la normalización de una trampa se puede testear con un
  fixture JSON, sin sockets ni hardware.
- `executeAdapterSafe` convierte dos clases de error en **fallos ruidosos**: un adapter que
  cambia el tenant o infla la severidad se detiene, en lugar de producir una alerta
confiable y falsa.
- Las erratas (supresión y remapeo) están en la pipeline, después de normalizar: una MIB
  corregida por el vendor se aplica sin tocar el adapter.
- La **gobernanza de las fuentes** acompaña al código: cada vendor tiene
  `research/olt/<vendor>/sources.yaml` y `compatibility.yaml`, con grado de confianza A–E y
  nivel de soporte L0–L4 (ver [ADR 0016](0016-gobernanza-de-fuentes-mib-y-niveles-de-soporte.md)).

### Malas

- **Un PEN desconocido no se puede clasificar.** `resolveVendorByOid` devuelve `null` y
  la trampa se trata como estándar. Un vendor no registrado produce una normalización
  genérica, que es exactamente la clase de dato "correcto pero inútil" que el producto
  quiere evitar.
- El contrato `supports()` más `normalize()` **duplica la información del PEN**: el vendor
  puede declarar un PEN y su `supports()` puede no aceptar la trampa. El registry exige
  las dos condiciones, pero la duplicación es una fuente de incoherencia.
- Mantener el registro al día es **trabajo manual**: cada PEN nuevo de IANA hay que
  agregarlo a mano.
- El orden de registro (`OpenBaseline` antes de `GenericXpon`) es una dependencia
  **implícita**: un contributor que registre su adapter al final, sin saber esto, puede
  cambiar el comportamiento de otro vendor.
- `executeAdapterSafe` puede rechazar una normalización legítima si el criterio de
  "inflación de severidad" no contempla el caso del vendor.
- Cada adapter es código propio que hay que mantener contra el firmware real del vendor:
  el costo por vendor es alto.

### Abiertas

- `DzsOltAdapter`, `UbiquitiOltAdapter` y `OpenBaselineOltAdapter` están registrados en
  `defaultAdapterRegistry` pero **no se re-exportan** desde
  `packages/monitoring/src/index.ts`, que sólo expone Standard, Huawei, ZTE, Nokia,
  FiberHome, Calix, Adtran, VSOL, BDCOM y GenericXpon.
- Los umbrales por vendor para la degradación óptica están embebidos en el detector y no
  salen de `research/olt/<vendor>/compatibility.yaml`.
- No hay un test que verifique que **todos** los adapters registrados siguen exportados.
