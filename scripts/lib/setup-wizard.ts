import readline from 'node:readline';

// ANSI color formatting
const isColorSupported =
  !process.env['NO_COLOR'] &&
  (process.stdout.isTTY || process.env['FORCE_COLOR'] === '1');

export const c = {
  reset: isColorSupported ? '\x1b[0m' : '',
  bold: isColorSupported ? '\x1b[1m' : '',
  dim: isColorSupported ? '\x1b[2m' : '',
  cyan: isColorSupported ? '\x1b[36m' : '',
  green: isColorSupported ? '\x1b[32m' : '',
  yellow: isColorSupported ? '\x1b[33m' : '',
  magenta: isColorSupported ? '\x1b[35m' : '',
  blue: isColorSupported ? '\x1b[34m' : '',
  red: isColorSupported ? '\x1b[31m' : '',
};

export interface WizardConfig {
  llmProvider: string;
  minimaxApiKey?: string;
  minimaxModel?: string;
  deepseekApiKey?: string;
  deepseekModel?: string;
  qwenApiKey?: string;
  qwenModel?: string;
  smartoltUseMock: boolean;
  smartoltBaseUrl?: string;
  smartoltApiKey?: string;
  databaseUrl?: string;
}

/**
 * Reads a single line of text from the user.
 */
export function ask(promptText: string, defaultValue?: string): Promise<string> {
  const defaultHint = defaultValue ? ` ${c.dim}(${defaultValue})${c.reset}` : '';
  const formattedPrompt = `${c.bold}${promptText}${c.reset}${defaultHint}: `;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(formattedPrompt, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed === '' && defaultValue !== undefined ? defaultValue : trimmed);
    });
  });
}

/**
 * Reads confidential text (e.g. API keys) with asterisk masking in TTY mode.
 */
export function askSecret(promptText: string, defaultValue?: string): Promise<string> {
  const hasDefault = Boolean(defaultValue && defaultValue !== '');
  const defaultHint = hasDefault ? ` ${c.dim}(leave empty to keep existing)${c.reset}` : '';
  const formattedPrompt = `${c.bold}${promptText}${c.reset}${defaultHint}: `;

  if (!process.stdin.isTTY) {
    return ask(promptText, defaultValue);
  }

  return new Promise((resolve) => {
    process.stdout.write(formattedPrompt);
    const stdin = process.stdin;
    let input = '';

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      process.stdout.write('\n');
    };

    const onData = (chunk: Buffer) => {
      const str = chunk.toString('utf8');
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '\n' || char === '\r' || char === '\u0004') {
          cleanup();
          const trimmed = input.trim();
          if (trimmed === '' && defaultValue !== undefined) {
            resolve(defaultValue);
          } else {
            resolve(trimmed);
          }
          return;
        }
        if (char === '\u0003') {
          // Ctrl+C
          cleanup();
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char.charCodeAt(0) >= 32) {
          input += char;
          process.stdout.write(`${c.dim}*${c.reset}`);
        }
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

/**
 * Single-selection multiple-choice prompt.
 */
export async function askChoice(
  promptText: string,
  options: Array<{ label: string; desc?: string }>,
  defaultIndex = 0,
): Promise<number> {
  console.log(`\n${c.bold}${c.cyan}?${c.reset} ${c.bold}${promptText}${c.reset}`);
  options.forEach((opt, idx) => {
    const isDefault = idx === defaultIndex;
    const num = `[${idx + 1}]`;
    const label = isDefault ? `${c.green}${c.bold}${opt.label}${c.reset}` : opt.label;
    const defaultTag = isDefault ? ` ${c.cyan}(default)${c.reset}` : '';
    const desc = opt.desc ? `\n    ${c.dim}${opt.desc}${c.reset}` : '';
    console.log(`  ${c.bold}${num}${c.reset} ${label}${defaultTag}${desc}`);
  });

  while (true) {
    const raw = await ask(`  Select an option [1-${options.length}]`, String(defaultIndex + 1));
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= options.length) {
      return parsed - 1;
    }
    console.log(`  ${c.red}Invalid choice. Please enter a number between 1 and ${options.length}.${c.reset}`);
  }
}

/**
 * Yes/No confirmation prompt.
 */
export async function askConfirm(promptText: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const raw = await ask(`${c.bold}${promptText}${c.reset} ${c.dim}${hint}${c.reset}`);
  if (raw === '') return defaultYes;
  return raw.toLowerCase().startsWith('y');
}

/**
 * Prints the welcome banner for FTTH-Copilot interactive CLI.
 */
export function printWelcomeBanner(): void {
  const line = '═'.repeat(65);
  console.log(`
${c.cyan}╔${line}╗
║${c.bold}                   FTTH-Copilot Setup Wizard                   ${c.reset}${c.cyan}║
║${c.dim}        AI-Powered Diagnostic Agent for FTTH / GPON ISPs         ${c.reset}${c.cyan}║
╚${line}╝${c.reset}
`);
}

/**
 * Runs the interactive development wizard.
 */
export async function runInteractiveWizard(
  existingEnv: Record<string, string>,
): Promise<WizardConfig> {
  printWelcomeBanner();

  console.log(`${c.bold}Step 1/3: AI Model & LLM Provider${c.reset}`);
  console.log(`${c.dim}Configure the model provider for automated telemetry reasoning and incident triage.${c.reset}`);

  const llmChoices = [
    {
      label: 'MiniMax',
      desc: 'Anthropic-compatible API (MiniMax-M3). Recommended for production speed and quality.',
    },
    {
      label: 'DeepSeek',
      desc: 'OpenAI-compatible API (deepseek-chat). Cost-effective reasoning model.',
    },
    {
      label: 'Qwen / DashScope',
      desc: 'OpenAI-compatible API (qwen-plus) from Alibaba Cloud.',
    },
    {
      label: 'Demo / Mock Mode',
      desc: 'Run locally without any AI API key (uses deterministic fixtures & rules).',
    },
  ];

  let defaultChoiceIdx = 0;
  if (existingEnv['LLM_PROVIDER'] === 'deepseek') defaultChoiceIdx = 1;
  else if (existingEnv['LLM_PROVIDER'] === 'qwen') defaultChoiceIdx = 2;
  else if (!existingEnv['LLM_PROVIDER']) defaultChoiceIdx = 3;

  const selectedIdx = await askChoice('Select your AI model provider:', llmChoices, defaultChoiceIdx);

  let llmProvider = '';
  let minimaxApiKey = existingEnv['MINIMAX_API_KEY'] ?? '';
  let minimaxModel = existingEnv['MINIMAX_MODEL'] ?? 'MiniMax-M3';
  let deepseekApiKey = existingEnv['DEEPSEEK_API_KEY'] ?? '';
  let deepseekModel = existingEnv['DEEPSEEK_MODEL'] ?? 'deepseek-chat';
  let qwenApiKey = existingEnv['QWEN_API_KEY'] ?? '';
  let qwenModel = existingEnv['QWEN_MODEL'] ?? 'qwen-plus';

  if (selectedIdx === 0) {
    llmProvider = 'minimax';
    console.log(`\n${c.bold}MiniMax Configuration:${c.reset}`);
    minimaxApiKey = await askSecret('Enter your MiniMax API Key', minimaxApiKey);
    minimaxModel = await ask('MiniMax Model Name', minimaxModel);
  } else if (selectedIdx === 1) {
    llmProvider = 'deepseek';
    console.log(`\n${c.bold}DeepSeek Configuration:${c.reset}`);
    deepseekApiKey = await askSecret('Enter your DeepSeek API Key', deepseekApiKey);
    deepseekModel = await ask('DeepSeek Model Name', deepseekModel);
  } else if (selectedIdx === 2) {
    llmProvider = 'qwen';
    console.log(`\n${c.bold}Qwen Configuration:${c.reset}`);
    qwenApiKey = await askSecret('Enter your Qwen API Key', qwenApiKey);
    qwenModel = await ask('Qwen Model Name', qwenModel);
  } else {
    llmProvider = '';
    console.log(`  ${c.yellow}ℹ Running in Demo/Mock AI mode (no API key required).${c.reset}`);
  }

  console.log(`\n${c.bold}Step 2/3: NMS & OLT Connectors${c.reset}`);
  console.log(`${c.dim}Configure integration with SmartOLT or Mikrowisp.${c.reset}`);

  const nmsChoices = [
    {
      label: 'Demo Mode (Mock Fixtures)',
      desc: 'Uses simulated OLT hardware with realistic GPON telemetry and ONU topology.',
    },
    {
      label: 'Real SmartOLT Connection',
      desc: 'Connects to a live SmartOLT instance via REST API.',
    },
  ];

  const currentNmsDefault = existingEnv['SMARTOLT_USE_MOCK'] === 'false' ? 1 : 0;
  const nmsIdx = await askChoice('SmartOLT connector mode:', nmsChoices, currentNmsDefault);

  let smartoltUseMock = true;
  let smartoltBaseUrl = existingEnv['SMARTOLT_API_BASE_URL'] ?? 'https://api.smartolt.com';
  let smartoltApiKey = existingEnv['SMARTOLT_API_KEY'] ?? '';

  if (nmsIdx === 1) {
    smartoltUseMock = false;
    smartoltBaseUrl = await ask('SmartOLT API Base URL', smartoltBaseUrl);
    smartoltApiKey = await askSecret('SmartOLT API Key', smartoltApiKey);
  }

  console.log(`\n${c.bold}Step 3/3: Database Infrastructure${c.reset}`);
  const dbChoices = [
    {
      label: 'Docker Compose (Automatic PostgreSQL on localhost:5432)',
      desc: 'Runs Postgres in a container. Recommended for standard development.',
    },
    {
      label: 'Native PostgreSQL (Custom connection string)',
      desc: 'Use an existing host or remote PostgreSQL server.',
    },
  ];

  const dbChoiceIdx = await askChoice('Select database setup:', dbChoices, 0);
  let databaseUrl = existingEnv['DATABASE_URL'] ?? 'postgresql://ftth:change-me@localhost:5432/ftth_copilot';

  if (dbChoiceIdx === 1) {
    databaseUrl = await ask('PostgreSQL DATABASE_URL', databaseUrl);
  }

  return {
    llmProvider,
    minimaxApiKey,
    minimaxModel,
    deepseekApiKey,
    deepseekModel,
    qwenApiKey,
    qwenModel,
    smartoltUseMock,
    smartoltBaseUrl,
    smartoltApiKey,
    databaseUrl,
  };
}
