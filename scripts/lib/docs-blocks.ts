/**
 * Extracción y parsing de los bloques de código de la documentación.
 *
 * Funciones puras: no tocan el disco ni el repositorio. Así se pueden testear
 * con `node --test` sin montar nada.
 */

/** Un bloque de código delimitado por cercas dentro de un archivo Markdown. */
export interface CodeBlock {
  /** Ruta del archivo, relativa al repo. */
  readonly file: string;
  /** Línea (1-based) donde abre la cerca. */
  readonly line: number;
  /** Etiqueta del lenguaje, en minúsculas (puede estar vacía). */
  readonly language: string;
  /** Atributos extra de la etiqueta de la cerca (`exec`, `skip`, ...). */
  readonly attributes: readonly string[];
  /** Contenido del bloque, sin la cerca. */
  readonly code: string;
  /** `false` cuando la cerca nunca cierra (Markdown roto). */
  readonly closed: boolean;
}

/** Clasificación de un bloque según lo que se puede verificar. */
export type BlockKind =
  | "bash"
  | "typescript"
  | "json"
  | "yaml"
  | "python"
  | "mermaid"
  | "env"
  | "informational";

const LANGUAGE_ALIASES: ReadonlyMap<string, BlockKind> = new Map([
  ["bash", "bash"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["zsh", "bash"],
  ["console", "bash"],
  ["shell-session", "bash"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["typescript", "typescript"],
  ["js", "typescript"],
  ["jsx", "typescript"],
  ["javascript", "typescript"],
  ["json", "json"],
  ["jsonc", "json"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["python", "python"],
  ["py", "python"],
  ["mermaid", "mermaid"],
  ["env", "env"],
  ["dotenv", "env"],
]);

export function classifyBlock(language: string): BlockKind {
  return LANGUAGE_ALIASES.get(language.trim().toLowerCase()) ?? "informational";
}

/**
 * Extrae los bloques de código de un Markdown.
 * Soporta cercas de backticks y de tildes, con información de lenguaje y
 * atributos opcionales después de la etiqueta.
 */
export function extractCodeBlocks(file: string, content: string): CodeBlock[] {
  const lines = content.split("\n");
  const blocks: CodeBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const open = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/.exec(lines[index] ?? "");
    if (!open) {
      index += 1;
      continue;
    }
    const indent = (open[1] ?? "").length;
    const fence = open[2] ?? "```";
    const fenceChar = fence[0] ?? "`";
    const fenceLength = fence.length;
    const info = (open[3] ?? "").trim();

    const closing = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLength},}[ \\t]*$`);
    const body: string[] = [];
    let cursor = index + 1;
    let closed = false;
    for (; cursor < lines.length; cursor += 1) {
      if (closing.test(lines[cursor] ?? "")) {
        closed = true;
        break;
      }
      body.push((lines[cursor] ?? "").slice(indent));
    }

    const [language = "", ...attributes] = info.split(/\s+/).filter(Boolean);
    blocks.push({
      file,
      line: index + 1,
      language: language.toLowerCase(),
      attributes,
      code: body.join("\n"),
      closed,
    });
    index = closed ? cursor + 1 : cursor;
  }

  return blocks;
}

/** Una invocación de comando dentro de un bloque de shell. */
export interface CommandInvocation {
  /** Texto original del comando. */
  readonly raw: string;
  /** Primer token que no es una asignación de variable. */
  readonly executable: string;
  /** Tokens del comando, sin comillas. */
  readonly args: readonly string[];
}

/** Divide un texto por separadores de nivel superior, respetando comillas. */
export function splitTopLevel(text: string, separators: readonly string[]): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quote) {
      current += char;
      if (char === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (separators.includes(char)) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Quita el comentario de una línea de shell, respetando comillas. */
export function stripShellComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (quote) {
      if (char === quote && line[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1] ?? ""))) {
      return line.slice(0, index);
    }
  }
  return line;
}

/** Divide una línea de shell en tokens, respetando comillas. */
export function tokenizeShell(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (quote) {
      if (char === quote && line[index - 1] !== "\\") {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  // Las redirecciones (`>archivo`, `2>&1`, `<placeholder>`) no son argumentos.
  return tokens.filter((token) => !/^\d*(>>?|<)/.test(token));
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PREFIX_COMMANDS = new Set(["sudo", "env", "command", "nohup", "time", "xargs", "then", "do", "else"]);

/**
 * Extrae los comandos de un bloque de shell.
 * Une continuaciones (`\` al final de línea) y parte por `&&`, `||`, `;`, `|` y
 * saltos de línea.
 */
export function parseShellCommands(code: string): CommandInvocation[] {
  const logicalLines: string[] = [];
  let buffer = "";
  for (const rawLine of code.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trimEnd();
    if (trimmed.endsWith("\\")) {
      buffer += `${trimmed.slice(0, -1)} `;
      continue;
    }
    logicalLines.push(`${buffer}${line}`);
    buffer = "";
  }
  if (buffer.trim()) logicalLines.push(buffer);

  const invocations: CommandInvocation[] = [];
  for (const logicalLine of logicalLines) {
    const withoutComment = stripShellComment(logicalLine);
    if (!withoutComment.trim()) continue;
    for (const chunk of splitTopLevel(withoutComment, ["&", "|", ";"])) {
      const raw = chunk.trim();
      if (!raw) continue;
      const tokens = tokenizeShell(raw);
      if (tokens.length === 0) continue;
      let cursor = 0;
      while (cursor < tokens.length && (ASSIGNMENT.test(tokens[cursor] ?? "") || PREFIX_COMMANDS.has(tokens[cursor] ?? ""))) {
        cursor += 1;
      }
      const executable = tokens[cursor];
      if (!executable) continue;
      invocations.push({ raw, executable, args: tokens.slice(cursor + 1) });
    }
  }
  return invocations;
}
