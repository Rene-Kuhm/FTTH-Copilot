# Feature: Extended Equipment Support for FTTH-Copilot

## Resumen

Extender FTTH-Copilot para soportar la máxima cantidad de equipos de fibra óptica, incluyendo OLTs y ONTs de todos los fabricantes relevantes, con soporte para las últimas tecnologías PON (GPON, XGS-PON, 25G-PON, 50G-PON).

## Tasks

### Phase 1: Research & Documentation
- [ ] 1.1 - Actualizar research/olt/dzs/ con specs completas de MXK y Velocity V6 ✓
- [ ] 1.2 - Investigar Nokia Lightspan FX-16/FX-8 specs detalladas
- [ ] 1.3 - Investigar ZTE TITAN C600/C650/C680 specs detalladas
- [ ] 1.4 - Investigar Ubiquiti UFiber OLT specs
- [ ] 1.5 - Investigar ONTs: Huawei EG8145V5, Nokia G-240G-A, LEOX LXT-010S-H

### Phase 2: Type Extensions
- [ ] 2.1 - Extender OltSummary con campos: ponPorts, maxPonPorts, ponType, uplinkInterfaces, formFactor, maxSubscribers
- [ ] 2.2 - Extender OnuDetail con campos: ponType, wifiStandard, ethernetPorts, potsPorts, maxSpeedMbps
- [ ] 2.3 - Agregar tipos para PON technologies (GPON, XG-PON, XGS-PON, 25G-PON, 50G-PON)
- [ ] 2.4 - Agregar tipos para OLT form factors (chassis, 2U, 1U, SFP)

### Phase 3: Vendor Adapters
- [ ] 3.1 - Mejorar adapter DZS/Zhone con traps del Zhone-GPON-MIB
- [ ] 3.2 - Registrar nuevo adapter para DZS Velocity V6
- [ ] 3.3 - Extender adapter Genérico XPON para nuevos vendors
- [ ] 3.4 - Agregar extractor de identidad para DZS (PEN 5504)

### Phase 4: SNMP Catalog Extensions
- [ ] 4.1 - Agregar traps DZS/Zhone al catalog
- [ ] 4.2 - Documentar OIDs de Zhone-GPON-MIB
- [ ] 4.3 - Crear fixtures de prueba para DZS Velocity V6
- [ ] 4.4 - Crear fixtures de prueba para Zhone MXK

### Phase 5: Connector Updates
- [ ] 5.1 - Actualizar SmartOLT connector para nuevos campos
- [ ] 5.2 - Actualizar Mikrotik adapter para nuevos campos
- [ ] 5.3 - Evaluar nuevo connector para DZS NMS (si API disponible)

## Equipment Matrix (Target)

| Fabricante | Familia | PON Ports | Max Subscribers | Estado |
|------------|---------|-----------|-----------------|--------|
| Huawei | MA5800-X17 | 256 | 32,768+ | P0 ✓ |
| Huawei | MA5800-X2 | 32 | 1,024 | P0 ✓ |
| Nokia | Lightspan FX-16 | 256 | 8,192+ | P0 partial |
| Nokia | Lightspan FX-8 | 128 | 4,096+ | P0 partial |
| ZTE | ZXA10 C600 | 576 | 50,000+ | P0 partial |
| ZTE | ZXA10 C650 | 112 | 10,000+ | P0 partial |
| Fiberhome | AN5516-01 | 256 | 8,192+ | P0 ✓ |
| DZS | Velocity V6 | 160 | 24,000 | P1 NEW |
| DZS | MXK-823 | 160 | 9,216 | P1 NEW |
| DZS | MXK-819 | 128 | 7,168 | P1 NEW |
| DZS | MXK-319 | 72 | 3,584 | P1 NEW |
| Calix | E7/E9 | - | - | P1 |
| Adtran | SDX 6000 | - | - | P1 |
| VSOL | V3600 | - | - | P1 |
| Ubiquiti | UF-OLT | 8-16 | 512 | P2 |

## Research Sources Used

- DZS Velocity V6 Datasheet (zhone.com)
- Zhone MXK 319/819/823 Datasheet
- Zhone-GPON-MIB (Observium)
- Nokia ISAM 7360 FX Datasheet
- Huawei MA5800 Series Datasheet
- ZTE ZXA10 C600/C650 Datasheet

## Commit Log

(No commits yet - feature in planning phase)
