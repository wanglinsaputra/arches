const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  white: '\x1b[37m',
  magenta: '\x1b[35m',
} as const;

export const c = {
  green: (s: string) => `${COLORS.green}${s}${COLORS.reset}`,
  red: (s: string) => `${COLORS.red}${s}${COLORS.reset}`,
  cyan: (s: string) => `${COLORS.cyan}${s}${COLORS.reset}`,
  yellow: (s: string) => `${COLORS.yellow}${s}${COLORS.reset}`,
  white: (s: string) => `${COLORS.white}${s}${COLORS.reset}`,
  magenta: (s: string) => `${COLORS.magenta}${s}${COLORS.reset}`,
};

export const BANNER = `
${c.cyan(' █████╗ ██████╗  ██████╗██╗  ██╗███████╗███████╗')}
${c.cyan('██╔══██╗██╔══██╗██╔════╝██║  ██║██╔════╝██╔════╝')}
${c.cyan('███████║██████╔╝██║     ███████║█████╗  ███████╗')}
${c.cyan('██╔══██║██╔══██╗██║     ██╔══██║██╔══╝  ╚════██║')}
${c.cyan('██║  ██║██║  ██║╚██████╗██║  ██║███████╗███████║')}
${c.cyan('╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝')}
${c.yellow('  Auto API Key Generator — by WangLinS')}
`;

export const SEPARATOR = c.magenta('─'.repeat(55));