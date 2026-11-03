/**
 * El cierre de dependencias del worker y la imagen que lo corre.
 *
 * La imagen del worker (`services/worker/Dockerfile`) copia los paquetes del
 * workspace **uno por uno**: es una imagen mínima, sin el paquete entero. Eso
 * la vuelve frágil: cuando un paquete nuevo entra en el cierre del worker —
 *como `@ftth-copilot/learning`, que entró con la Fase 0 del learning loop—
 * y nadie agrega su `COPY`, la imagen arranca y se cae al importar.
 *
 * El síntoma es feo y tardío: el contenedor entra en crash-loop con
 * `Cannot find package '@ftth-copilot/learning'`, y sólo se ve al desplegar.
 * El CI no lo agarraba porque los tests del worker corren en el workspace,
 * no en la imagen.
 *
 * Este módulo calcula el cierre de dependencias de workspace del worker y
 * contrasta con el Dockerfile qué paquetes de ese cierre no están copiados.
 * El test que lo acompaña es la regla que falla antes del despliegue.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Un paquete del workspace. */
export interface WorkspacePackage {
  /** El nombre del paquete, por ejemplo `@ftth-copilot/learning`. */
  readonly name: string;
  /** El directorio del paquete, relativo a la raíz del repo. */
  readonly dir: string;
  /** Sus dependencias de runtime. */
  readonly dependencies: Readonly<Record<string, string>>;
}

/** Los directorios donde `pnpm-workspace.yaml` busca miembros. */
const WORKSPACE_ROOTS = ['apps', 'packages', 'packages/connectors', 'services'] as const;

/**
 * Lee los paquetes del workspace con su nombre, su directorio y sus
 * dependencias de runtime.
 *
 * Sólo se miran `dependencies`: la imagen del worker se instala con `--prod`,
 * así que un `devDependency` no viaja. Un paquete de runtime que falte en la
 * imagen es un bug; uno de desarrollo no.
 */
export function readWorkspacePackages(repoRoot: string): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>();

  for (const root of WORKSPACE_ROOTS) {
    const dir = path.join(repoRoot, root);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageDir = path.join(dir, entry.name);
      const manifest = path.join(packageDir, 'package.json');
      if (!fs.existsSync(manifest)) continue;
      const json = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
        name?: string;
        dependencies?: Record<string, string>;
      };
      if (!json.name) continue;
      packages.set(json.name, {
        name: json.name,
        dir: path.relative(repoRoot, packageDir).split(path.sep).join('/'),
        dependencies: json.dependencies ?? {},
      });
    }
  }

  return packages;
}

/**
 * El cierre transitivo de dependencias de workspace del paquete raíz.
 *
 * Devuelve los nombres de los paquetes que el worker necesita en runtime,
 * incluyendo el mismo worker.
 */
export function dependencyClosure(
  packages: ReadonlyMap<string, WorkspacePackage>,
  rootName: string,
): string[] {
  const seen = new Set<string>();

  const walk = (name: string): void => {
    if (seen.has(name)) return;
    const pkg = packages.get(name);
    if (!pkg) return;
    seen.add(name);
    for (const dependency of Object.keys(pkg.dependencies)) {
      if (packages.has(dependency)) walk(dependency);
    }
  };

  walk(rootName);
  return [...seen].sort();
}

/**
 * Los paquetes del cierre que el Dockerfile no copia.
 *
 * Un paquete está copiado si el Dockerfile tiene una instrucción `COPY` que
 * empieza por su directorio. La comparación ignora los espacios y el `./`
 * inicial, que es como varies el estilo de línea.
 */
export function findUncopiedPackages(
  dockerfile: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
  closure: readonly string[],
): string[] {
  const copied = dockerfile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('COPY '))
    .map((line) => line.slice('COPY '.length).trim());

  const missing: string[] = [];
  for (const name of closure) {
    const pkg = packages.get(name);
    if (!pkg) continue;
    const prefix = `${pkg.dir}/`;
    const isCopied = copied.some((target) => {
      const [destination] = target.split(/\s+/);
      return destination !== undefined && destination.replace(/^\.\//, '').startsWith(prefix);
    });
    if (!isCopied) missing.push(`${name} (${pkg.dir})`);
  }

  return missing;
}
