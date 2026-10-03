# ITU-T G.HSP — 50G-PON & 25G-PON

> **Roadmap Fase ODN** — Emerging standards tracking
> **Status:** Documented; some vendor support announced

## TL;DR

**ITU-T G.9804 (G.HSP)** defines the higher-speed PON family:
- **25G-PON**: 25 Gbps downstream / 10 or 25 Gbps upstream (MSA-25 specification)
- **50G-PON**: 50 Gbps downstream / 12.5 / 25 / 50 Gbps upstream, symmetric
- **Class N1 / N2**: extended optical budget for 50G (≥ 35 dB, up to 40 dB)

These are the **next-generation FTTH** after XGS-PON. Huawei MA5800-X17/X15/X7 already
advertise 50G-PON combo ports (16 per chassis).

## Wavelength plan

| Technology | Downstream λ | Upstream λ | Notes |
|-----------|---------------|-------------|-------|
| GPON | 1490 nm | 1310 nm | Legacy |
| XG-PON | 1577 nm | 1270 nm | 10G/2.5G asymmetric |
| XGS-PON | 1577 nm | 1270 nm | 10G symmetric |
| 25G-PON (MSA) | 1358 nm (down) / 1300 nm (up) | variable | Coexistence with XGS-PON planned |
| 50G-PON (G.HSP) | 1342 nm (down) | 1300 nm (up) | New C+ / N1 / N2 budget classes |

The coexistence with GPON/XGS-PON is non-trivial — different downstream wavelengths
require a Coexistence Element (CE) at the OLT. Vendors with combo support (Huawei MA5800
Flex-PON, ZTE C600, DZS Velocity V6) implement the CE in their line cards.

## Class N1 vs Class N2

For 50G-PON, ITU-T introduces two new optical classes:

- **Class N1**: 29 dB optical budget, up to 20 km reach (split 1:64)
- **Class N2**: 33 dB optical budget, up to 20 km reach (split 1:128) — for higher split ratios

These are stricter than Class C+ (32 dB) and Class C++ (35 dB) used in XGS-PON because
50G signals need higher power budget to overcome chromatic dispersion at the new wavelength.

## How FTTH-Copilot models it

`PonTechnology` already includes `'25G-PON'` and `'50G-PON'`. `OpticalClass` now
includes `'N1'` and `'N2'`.

For Huawei MA5800-X17 we record:
- `ponTechnologies: [GPON, XG-PON, XGS-PON, Combo-GPON-XGS-PON, 50G-PON]`
- `opticalClass: 'C++'` (default), or `'N2'` when configured for 50G combo

## Vendors with 50G-PON support

| Vendor | Product | 50G support | Coexistence |
|--------|---------|-------------|-------------|
| Huawei | MA5800-X17/X15/X7 | ✓ (16 combo ports) | Flex-PON card |
| Nokia | Lightspan FX-12 | ✓ (planned) | Quillion chipset |
| ZTE | ZXA10 C680 | ✓ (planned) | TITAN combo card |
| Calix | AXOS systems | Watch | — |
| Cisco | NCS 1010 | ✓ | Coexistence via NCS 1004 |

## Sources

- **ITU-T G.9804.1** — Requirements for higher-speed PON (G.HSP)
- **ITU-T G.9804.3** — 50G-PON physical layer
- **25GS-PON MSA Group** — 25G-PON specification
- **Huawei MA5800-X17 datasheet** — confirms 50G combo support
- **Nokia Quillion** — chipset vendor for 50G-PON line cards

## Operational impact

For FTTH-Copilot monitoring purposes, 50G-PON introduces:

1. **Optical SNR monitoring** — required at 50G due to dispersion
2. **FEC efficiency** — RS(544,514) instead of RS(255,239)
3. **Latency targets** — ≤ 1 ms for 50G fronthaul
4. **Power budget** — Class N2 adds 33 dB, which means shorter drop segments or
   different splitter ratios

These are reflected in `OltDetail.builtInOtdr` (for Huawei MA5800-X17) and
`OnuDetail.opticalClass` (N1/N2 for 50G ONUs).
