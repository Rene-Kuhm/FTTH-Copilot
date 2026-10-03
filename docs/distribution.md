# Distribution Plan — FTTH-Copilot v0.2.2

> **Propósito:** convertir interés técnico en conversaciones de piloto.
> Este documento es el plan de outreach para equipos de ingeniería y producto.
> No es marketing público — es una guía para contacto técnicamente cualificado.

> **Estado de release:** `v0.2.2` es el patch release de distribución multiplataforma.
> El código y la documentación están alineados; los instaladores están disponibles en
> [GitHub Releases](https://github.com/Rene-Kuhm/FTTH-Copilot/releases/tag/v0.2.2).

| Plataforma | Artefactos | Validación |
|---|---|---|
| Web / Docker | Demo y despliegue productivo | Disponible para evaluación |
| Linux | `.deb` y AppImage | Generados y validados |
| Windows | `.msi` y NSIS `.exe` | Ejecutado bajo Wine/Proton; pendiente prueba nativa opcional |
| Android | APK | Generado; unsigned, instalación manual |

---

## 1. Funnel de conversión

```
Descubrimiento
    │
    ├── README (GitHub) ─────────────────────────────────┐
    ├── Landing page tecnodespegue.com ────────────────────┤
    └── Comunidad (LinkedIn, Reddit, foro ISP) ────────────┤
                                                          ▼
    Demo starts (./scripts/run-demo.sh)
    │
    ├── Completa el diagnóstico en el chat
    ├── Ve el video del walkthrough (37s)
    └── Lee el case study sintético
                                                          ▼
    Demo completada
    │
    ├── Abre issue con etiqueta `evaluation`
    └── Envia email a renekuhm2@gmail.com
                                                          ▼
    Sesión técnica guiada
    │
    ├── Walkthrough con escenarios reales del ISP
    ├── Mide contra los pilot gates
    └── Decision: piloto / licencia / próximo contacto
```

---

## 2. Métricas de conversión

| Etapa | Métrica | Método de tracking |
|---|---|---|
| Descubrimiento | Visitas al README | GitHub Insights (público) |
| Descubrimiento | Visitas a la landing page | Analytics del sitio (tecnodespegue.com) |
| Demo | `git clone` o `run-demo.sh` starts | GitHub stars/watch, no tracking fino |
| Interés | Issues con etiqueta `evaluation` | GitHub Issues |
| Interés | Emails a renekuhm2@gmail.com | Email threads |
| Conversión | Sesión técnica agendada | CRM o tracking manual |
| Conversión | Piloto autorizado | Contrato / Issue con etiqueta `pilot` |

**Nota:** GitHub no provee analytics granulares de clones. La mejor señal de interés es:
1. Stars y watches en el repo
2. Issues abiertos con `evaluation`
3. Emails recibidos

---

## 3. Comunidades objetivo

### 3.1 Alta prioridad

| Comunidad | Canal | Audience | Cómo llegar |
|---|---|---|---|
| **MikroTik Forums / User Groups** | [forum.mikrotik.com](https://forum.mikrotik.com) | ISPs que usan RouterOS + FTTH | Post técnico sobre integración MikroTik + NOC |
| **Reddit r/networking, r/fiberoptics** | reddit.com | NOC engineers, ISP owners | Post de caso de estudio sintético |
| **LinkedIn: FTTH/GPON ISP Network** | linkedin.com | ISP decision makers, NOC leads | Article técnico + video embed |
| **Facebook: ISP Latinoamérica** | fb groups | ISPs en Argentina, Colombia, México | Grupo privado de ISPs regionales |
| **WISP / Wireless ISP forums** | various | WISPs evaluando FTTH | Comparación FTTH vs PtMP |

### 3.2 Media prioridad

| Comunidad | Canal | Audience | Cómo llegar |
|---|---|---|---|
| **NOC operators en Twitter/X** | @noc operators | NOC leads |threads sobre diagnóstico offline-ONU |
| **GitHub trending** | github.com/trending | Developers/architects | Star Farming + README optimization |
| **Stack Overflow** | stackoverflow.com | Developers evaluando integración | Pregunta/respuesta con tag [ftth] |

### 3.3 Baja prioridad (largo plazo)

| Comunidad | Canal | Audience |
|---|---|---|
| MEF Forum | events.mef.net | Enterprise NOC / metro |
| NANOG mailing list | nanog.org | Network engineers US |

---

## 4. Mensajes de outreach

### 4.1 Post técnico corto (Reddit, LinkedIn, MikroTik Forum)

**Titular:** "Diagnóstico de OFFLINE-ONU en 3 segundos sin leer traps SNMP"

```
FTTH-Copilot es un agente que diagnoses FTTH incidents
usando SmartOLT o Mikrowisp como fuente de evidencia.

En lugar de parsear traps SNMP o ir al dashboard del NMS,
preguntás en lenguaje natural:

  "¿Cuáles ONUs están offline y por qué?"

El router decide si responder con 0 llamadas LLM
(directo) o hacer una investigación completa
(investigation). Si la evidencia no alcanza,
el sistema se abstiene — no inventa causa raíz.

Demo reproducible: github.com/Rene-Kuhm/FTTH-Copilot
Video: 37 segundos (direct + investigation + TruthGate)
```

### 4.2 Post de comunidad ISP (Facebook grupos, WhatsApp)

**Titular:** "Herramienta de diagnóstico NOC para ISPs con SmartOLT o Mikrowisp"

```
Si operan SmartOLT o Mikrowisp, FTTH-Copilot
automatiza la diagnosis de OFFLINE ONUs.

Características:
✅ Detecta ONUs offline y deriva óptica
✅ No necesita SNMP ni equipamiento extra
✅ Datos sintéticos para probar sin riesgos
✅ Docker compose: `docker compose up` y listo

Para evaluar: github.com/Rene-Kuhm/FTTH-Copilot
No requiere credenciales reales para el demo.
```

### 4.3 Artículo técnico (LinkedIn, blog)

**Titular:** "Del dato de red a la evidencia operativa: cómo FTTH-Copilot diagnóstica sin inventar"

```
El problema no es la falta de datos en un NOC — es el
tiempo y la carga cognitiva para convertirlos en una
decisión defendible.

FTTH-Copilot usa tres principios:

1. Determinismo cuando alcanza: consultas de estado
   se responden sin LLM (0 llamadas, ~3ms)

2. IA cuando aporta: investigación de causa raíz
   usa el modelo solo cuando es necesario

3. Abstención cuando falta evidencia: si la herramienta
   no completó, el sistema lo dice — no inventa

El demo cubre el caso de un ISP mediano con 5 OLTs
y 42 ONUs, escenarios de planta externa embebidos.

Link: github.com/Rene-Kuhm/FTTH-Copilot
```

---

## 5. Checklist de outreach (primeras 2 semanas post-lanzamiento)

### Semana 1

- [ ] Publicar en MikroTik Forum (post técnico corto)
- [ ] Publicar en Reddit r/networking y r/fiberoptics
- [ ] LinkedIn: article técnico + video embed
- [ ] GitHub: verificar que el README sea claro en los primeros 5 segundos de visita
- [ ] GitHub: agregar topics `ftth`, `noc`, `fiber`, `gpont`, `isp` al repo

### Semana 2

- [ ] Contactar 3 ISPs directamente (email o LinkedIn) con el case study
- [ ] Grupo Facebook ISP Latinoamérica: post de comunidad
- [ ] GitHub: monitorear issues con etiqueta `evaluation`
- [ ] Landing tecnodespegue.com: verificar que el video y el demo link funcionan
- [ ] Email: setup de filtro para tracking de solicitudes de piloto

### Continuación

- [ ] Iterar mensaje según feedback de los primeros contactos
- [ ] Agregar GitHub issue template para `evaluation` requests
- [ ] Preparar paquete de piloto: alcance, duración, métricas de éxito, criterios de salida

---

## 6. GitHub issue template para evaluación

El repo debería tener un template `evaluation_request.yml`:

```yaml
name: Evaluation Request
description: Solicitar una sesión técnica de evaluación de FTTH-Copilot
title: "[Evaluation] "
labels: ["evaluation"]
body:
  - type: markdown
    attributes:
      value: |
        ## Evaluador
        - Nombre / empresa:
        - Rol: ISP owner / NOC lead / Ingeniero de red / Otro
        - País / región:

        
        ## Entorno actual
        - NMS: SmartOLT / Mikrowisp / MikroTik / Otro
        - Flota: ~X OLTs, ~Y ONUs
        - Rol actual del diagnóstico: manual / semi-automatizado

        
        ## Qué te gustaría evaluar
        - Diagnóstico offline-ONU
        - Degradación de señal
        - Correlación de incidentes
        - Otro:

        
        ## Disponibilidad
        - Días / horarios disponibles para sesión técnica (30 min):
```

---

## 7. Package de contacto para outreach

Al contactar ISPs directamente, incluir:

1. **Breve descripción** (2-3 oraciones): qué es, para quién es, qué resuelve
2. **Link al demo**: `github.com/Rene-Kuhm/FTTH-Copilot`
3. **Link al video**: 37 segundos, no requiere registro
4. **Link al case study**: `docs/case-study-synthetic.md`
5. **Propuesta de valor**: "Diagnóstico offline-ONU sin equipamiento extra, sin SNMP, sin complejidad"
6. **CTA claro**: "Querés una sesión técnica de 30 minutos?" → `renekuhm2@gmail.com`

---

## 8. Seguimiento y tracking

| Acción | Estado esperado | Seguimiento |
|---|---|---|
| Outreach enviado | Respuesta en 3-5 días | Si no hay respuesta, reenviar 1 vez a los 7 días |
| Sesión técnica agendada | Confirmación por email | Calendly o email manual |
| Sesión técnica completada | Feedback del ISP | Documentar en CRM/notas |
| Piloto autorizado | Contrato o issue con `pilot` | Track en GitHub project |
| No interested | Archivo con razón | Para iterar mensaje |

---

## 9. Repositorios de soporte para outreach

| Recurso | URL | Para qué |
|---|---|---|
| Landing page ES | tecnodespegue.com/ftth-copilot | Evaluadores no técnicos |
| Landing page EN | tecnodespegue.com/en/ftth-copilot | Evaluadores internacionales |
| Video demo | 37 segundos, 16:9 | Embed en posts |
| GitHub repo | github.com/Rene-Kuhm/FTTH-Copilot | Evaluadores técnicos |
| Demo repo | (mismo repo) | `docker-compose.demo.yml` |
| Email contacto | renekuhm2@gmail.com | Sesiones técnicas |

---

## 10. Acciones inmediatas post-v0.2.2

- [ ] Agregar GitHub issue template para `evaluation`
- [ ] Agregar topics al repo: `ftth`, `noc`, `fiber`, `gpont`, `isp`
- [ ] Verificar que el landing page está actualizado con el video y el demo link
- [ ] Enviar primer outreach a 3 ISPs conocidos
- [ ] Crear filtro en email para trackear solicitudes de piloto
