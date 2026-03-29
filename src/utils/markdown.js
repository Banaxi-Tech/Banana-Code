import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

marked.use(markedTerminal({
    // Prominent headings
    firstHeading: chalk.magenta.bold.underline,
    heading: chalk.magenta.bold,
    
    // Stronger emphasis for other elements
    strong: chalk.yellow.bold,
    em: chalk.italic,
    codespan: chalk.bgRgb(40, 40, 40).yellow,
    
    // Custom tab/padding
    tab: 4
}));

export function printMarkdown(text) {
    process.stdout.write(marked.parse(text));
}
