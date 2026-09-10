# Procedimiento de Gestión de Fuentes y MIBs OLT

Este documento establece la gobernanza, ciclo de vida y criterios legales para incorporar, auditar, actualizar o retirar fuentes MIB y definiciones de telemetría de fabricantes OLT (Roadmap Fase 1).

---

## 1. Reglas de Admisibilidad y Confidencialidad

1. **Gate 1 — Admisibilidad obligatoria**:
   Ningún OID, trampa o convención de fabricante puede incorporarse al catálogo sin un `source_id` único, grado de confianza (A–E), modelos asignados, versión de firmware (o explícitamente `unknown`), fecha de obtención y estado de licencia.
2. **Propiedad Intelectual y Licencias**:
   - Para fuentes permisivas (MIT, BSD, Apache, CC-BY), se puede enlazar y citar directamente.
   - Para fuentes propietarias o con licencia restringida (`restricted` / `review-required`):
     - **NO** se redistribuyen archivos MIB propietarios en el repositorio.
     - Se registra la URL oficial, el editor, la fecha de consulta, el hash SHA-256 local (si fue obtenido lícitamente) y únicamente los hechos mínimos observables (OID, nombre de trampa, tipos de varbinds).
3. **Privacidad y Secretos**:
   - Queda estrictamente prohibido incluir credenciales SNMP (comunidades, usuarios USM, claves de autenticación o cifrado), direcciones IP privadas de producción, identificadores de abonados o números de serie reales de clientes.
   - Todo fixture de prueba en `fixtures/` debe ser sanitizado o sintetizado en laboratorio.

---

## 2. Jerarquía de Confianza de Fuentes

| Grado | Naturaleza | Requisito de Validación |
|---|---|---|
| **A** | Estándar oficial (IETF/ITU-T/BBF) o portal/documento oficial del fabricante con versión. | Autosuficiente para admitir OIDs y trampas. |
| **B** | MIB del fabricante publicada en proyectos maduros reconocidos (LibreNMS, Observium, Net-SNMP). | Requiere verificación de origen, revisión y licencia. |
| **C** | Proyecto comunitario o herramienta con evidencia de prueba sobre hardware identificado. | Requiere al menos una segunda fuente independiente concordante. |
| **D** | Manual espejo, blog técnico, plantilla comunitaria o script no verificado. | Solo permite descubrimiento; no habilita alertas activas sin contraste. |
| **E** | Comentario en foro o fragmento no documentado. | Hipótesis de investigación exclusivamente. |

---

## 3. Niveles de Compatibilidad (L0 a L4)

| Nivel | Denominación | Evidencia mínima | Uso permitido |
|---|---|---|---|
| **L0** | Detectado | Enterprise OID o sysObjectID. | Inventario de red; sin interpretación. |
| **L1** | Documentado | MIB o especificación oficial (Grado A o 2x B). | Decodificación en observación. |
| **L2** | Simulado | L1 + pruebas unitarias con datagramas binarios reales. | Laboratorio y simulación offline. |
| **L3** | Captura real | L2 + captura sanitizada de tráfico aportada por operador. | Modo sombra en infraestructura real. |
| **L4** | Certificado en campo | Prueba de generación, recepción e incidentes en red viva. | Producción activa para ese modelo y firmware. |

---

## 4. Retiro de Fuentes y Reemplazo de MIBs

### 4.1 Fuente caída o URL no disponible
Si una URL deja de responder (HTTP 404, 410 o dominio expirado):
1. **Verificar espejo o archivo**: Comprobar si existe snapshot oficial o enlace canónico en Internet Archive (Wayback Machine).
2. **Actualizar registro**: Modificar el campo `url` en `sources.yaml` indicando el nuevo enlace o mirror oficial.
3. **Degradación si no hay respaldo**: Si la fuente era Grado A o B y no existe copia comprobable ni segunda fuente, el grado de confianza de sus hechos debe degradarse a `D` o `E`, reduciendo el nivel de soporte a `L0` o `provisional`.

### 4.2 MIB reemplazada o declarada obsoleta por el fabricante
Cuando un fabricante lanza una nueva versión de MIB o firmware que cambia los OIDs:
1. **Preservar el registro previo**: La fuente antigua no se borra; se añade `status: deprecated` en los `facts` afectados.
2. **Crear nueva fuente**: Registrar un nuevo `source_id` (ejemplo: `huawei-ma5800-gpon-alarm-002`) con el nuevo firmware y MIB.
3. **Diferenciación por firmware**: El adaptador del fabricante seleccionará el OID adecuado según el firmware reportado en el contexto del equipo, o mantendrá ambas formas si el firmware es indeterminado.

---

## 5. Verificación Automatizada

La coherencia de todos los archivos bajo `research/olt/<vendor>/` se verifica en el pipeline de CI mediante:

```bash
pnpm check:sources
pnpm generate:matrix
```

Cualquier identificador duplicado, OID con formato inválido, referencia rota o grado no admitido causará la falla inmediata del build.
