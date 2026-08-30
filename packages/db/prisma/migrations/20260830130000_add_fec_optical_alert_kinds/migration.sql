-- Add the AIOps Fase 1 alert kinds: FEC degradation and optical degradation.
ALTER TYPE "AlertKind" ADD VALUE 'fec_degradation';
ALTER TYPE "AlertKind" ADD VALUE 'optical_degradation';
