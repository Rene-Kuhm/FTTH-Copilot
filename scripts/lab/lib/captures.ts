/**
 * LibreNMS SNMP capture manifest of the virtual test bench.
 *
 * The captures are real device walks (`tests/snmpsim/*.snmprec` in the
 * LibreNMS repository) and they are **GPL-3.0**, so they are never copied into
 * this repository: `scripts/lab/fetch-captures.ts` downloads them from the
 * commit pinned here into `docker/lab/captures/`, which `.gitignore` excludes.
 * Provenance (repository, commit, license) is recorded in
 * `docker/lab/README.md`.
 *
 * snmpsim serves one capture per SNMP community and derives the community from
 * the data file name: `smartax.snmprec` is the `smartax` community.
 */

/** Upstream repository that publishes the captures. */
export const LIBRENMS_REPOSITORY = 'librenms/librenms';

/** Pinned commit: the captures are immutable for a given bench revision. */
export const LIBRENMS_COMMIT = '1c22ea7cae6eebb3856c281effd6eb64cf4bf53a';

/** License of the capture files. They are downloaded, never committed. */
export const LIBRENMS_CAPTURE_LICENSE = 'GPL-3.0';

/** Repository-relative directory the captures are downloaded into. */
export const CAPTURES_DIRECTORY = 'docker/lab/captures';

/** Suffix of an snmpsim data file. */
const CAPTURE_SUFFIX = '.snmprec';

export interface CaptureEntry {
  /** File name inside the LibreNMS `tests/snmpsim` directory. */
  readonly file: string;
  /** Vendor of the captured OLT. */
  readonly vendor: string;
  /** Model reported by the capture. */
  readonly model: string;
}

/**
 * One OLT family per supported vendor, plus the extra firmware variants that
 * change the walked object set. Every file must contain `sysDescr`
 * (`1.3.6.1.2.1.1.1.0`), which is what `lab:check` compares against.
 */
export const CAPTURES: readonly CaptureEntry[] = [
  { file: 'smartax.snmprec', vendor: 'Huawei', model: 'SmartAX MA5800' },
  { file: 'smartax-mdu.snmprec', vendor: 'Huawei', model: 'SmartAX MDU' },
  { file: 'zxa10.snmprec', vendor: 'ZTE', model: 'ZXA10 C320' },
  { file: 'zxa10_c320.snmprec', vendor: 'ZTE', model: 'ZXA10 C320' },
  { file: 'zxa10_c600.snmprec', vendor: 'ZTE', model: 'ZXA10 C600' },
  { file: 'fiberhome_an5516-01.snmprec', vendor: 'FiberHome', model: 'AN5516-01' },
  { file: 'fiberhome_an5516-04.snmprec', vendor: 'FiberHome', model: 'AN5516-04' },
  { file: 'fiberhome_an5516-04b.snmprec', vendor: 'FiberHome', model: 'AN5516-04B' },
  { file: 'fiberhome_an5516-06.snmprec', vendor: 'FiberHome', model: 'AN5516-06' },
  { file: 'vsolution_v1600d.snmprec', vendor: 'V-SOL', model: 'V1600D' },
];

/**
 * The snmpsim community that serves a capture: the file stem.
 *
 * @throws when the file name is not an snmpsim data file, because a capture
 *   that snmpsim cannot address by community would silently never be tested.
 */
export function communityFor(file: string): string {
  if (!file.endsWith(CAPTURE_SUFFIX) || file.length === CAPTURE_SUFFIX.length) {
    throw new Error(`"${file}" is not an snmpsim data file (*${CAPTURE_SUFFIX})`);
  }
  return file.slice(0, -CAPTURE_SUFFIX.length);
}

/** Raw URL of a capture at a pinned commit. */
export function captureUrl(file: string, commit: string = LIBRENMS_COMMIT): string {
  return `https://raw.githubusercontent.com/${LIBRENMS_REPOSITORY}/${commit}/tests/snmpsim/${file}`;
}

/** Repository-relative path the capture is downloaded to. */
export function captureRelativePath(file: string): string {
  return `${CAPTURES_DIRECTORY}/${file}`;
}

/** Manifest entries whose file is not present in the given directory listing. */
export function missingCaptures(
  presentFiles: Iterable<string>,
  entries: readonly CaptureEntry[] = CAPTURES,
): CaptureEntry[] {
  const present = new Set(presentFiles);
  return entries.filter((entry) => !present.has(entry.file));
}
