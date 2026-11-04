/**
 * Read-only enforcement for audit commands (2D-2D; the 2D-2C shadow run used the same guard as a
 * `/tmp` preload). Call before connecting. It turns off mongoose's automatic collection and index
 * creation (`TVReadAiring` and `Program` keep the defaults) and inspects every command the driver
 * starts: anything not on the read allowlist, or a `$out`/`$merge` pipeline, ends the process with code 97 before the
 * command is sent. `summary()` tallies the commands by name and collection.
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

export const READ_ONLY_VIOLATION_EXIT = 97;

const WRITE_COMMANDS = new Set([
  'insert', 'update', 'delete', 'findAndModify', 'findandmodify', 'bulkWrite', 'createIndexes', 'create', 'drop', 'dropIndexes',
  'dropDatabase', 'renameCollection', 'collMod', 'applyOps', 'createUser', 'compact', 'reIndex', 'convertToCapped', 'cloneCollectionAsCapped',
]);

export function isWriteCommand(name: string, command: Record<string, unknown>): boolean {
  const pipeline = JSON.stringify(command.pipeline ?? []);
  return WRITE_COMMANDS.has(name) || pipeline.includes('"$out"') || pipeline.includes('"$merge"');
}

/** Enforcement is an allowlist: a command nobody listed (mapReduce, setParameter, user/role management, ...) aborts instead of passing. */
const READ_COMMANDS = new Set([
  'find', 'aggregate', 'getMore', 'count', 'distinct', 'explain', 'killCursors', 'endSessions', 'ping',
  'collStats', 'dbStats', 'serverStatus', 'buildInfo', 'hello', 'isMaster', 'ismaster', 'hostInfo',
  'listCollections', 'listIndexes', 'listDatabases', 'connectionStatus', 'saslStart', 'saslContinue',
]);

export function isAllowedCommand(name: string, command: Record<string, unknown>): boolean {
  return READ_COMMANDS.has(name) && !isWriteCommand(name, command);
}

let installed: { total: number; counts: Record<string, number> } | null = null;

export function installReadOnlyGuard(): { summary: () => { total: number; counts: Record<string, number> } } {
  if (!installed) {
    const tally = { total: 0, counts: {} as Record<string, number> };
    installed = tally;
    mongoose.set('autoIndex', false);
    mongoose.set('autoCreate', false);
    // mongoose ships its own driver copy; patch that one, not the top-level `mongodb` package.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MongoClient } = require(require.resolve('mongodb', { paths: [path.dirname(require.resolve('mongoose'))] }));
    const connect = MongoClient.prototype.connect;
    MongoClient.prototype.connect = function guardedConnect(this: any, ...args: unknown[]) {
      if (!this.options?.monitorCommands) throw new Error('read-only guard: command monitoring is off');
      this.on('commandStarted', (event: { commandName: string; command: Record<string, unknown> }) => {
        const target = event.command[event.commandName];
        const collection = typeof target === 'string' ? target : '';
        if (!isAllowedCommand(event.commandName, event.command)) {
          fs.writeSync(2, `READ_ONLY_GUARD abort: ${event.commandName} ${collection}\n`);
          process.exit(READ_ONLY_VIOLATION_EXIT);
        }
        const key = `${event.commandName}:${collection}`;
        tally.counts[key] = (tally.counts[key] ?? 0) + 1;
        tally.total++;
      });
      return connect.apply(this, args);
    };
    const mongooseConnect = mongoose.connect.bind(mongoose);
    (mongoose as any).connect = (uri: string, opts: Record<string, unknown> = {}) => mongooseConnect(uri, { ...opts, monitorCommands: true });
  }
  const tally = installed;
  return { summary: () => ({ total: tally.total, counts: { ...tally.counts } }) };
}
