#!/usr/bin/env node
/**
 * gaib — sovereign secrets CLI for loa-freeside.
 *
 * Entry point. clipanion routes paths like ["secrets", "pull"] to the
 * matching command class.
 */
import { Cli } from 'clipanion';

import { GaibHelpCommand } from './commands/help.js';
import { SecretsPullCommand } from './commands/pull.js';
import { SecretsPushCommand } from './commands/push.js';

const cli = new Cli({
  binaryLabel: 'gaib',
  binaryName: 'gaib',
  binaryVersion: '0.1.0',
});

cli.register(GaibHelpCommand);
cli.register(SecretsPullCommand);
cli.register(SecretsPushCommand);

cli.runExit(process.argv.slice(2));
