'use strict';

const { initDb } = require('./db');
const { addUser, removeUser, listUsers } = require('./features/auth/users');

async function main() {
  const [cmd, arg1, arg2] = process.argv.slice(2);
  await initDb();

  if (cmd === 'add-user') {
    if (!arg1 || !arg2) {
      throw new Error('Usage: node server/cli.js add-user <username> <password>');
    }
    const user = await addUser(arg1, arg2);
    console.log(`User '${user.username}' added.`);
    return;
  }

  if (cmd === 'remove-user') {
    if (!arg1) throw new Error('Usage: node server/cli.js remove-user <username>');
    const user = await removeUser(arg1);
    console.log(`User '${user.username}' removed.`);
    return;
  }

  if (cmd === 'list-users') {
    const users = await listUsers();
    if (!users.length) {
      console.log('No users configured.');
      return;
    }
    console.log('Users:');
    for (const u of users) {
      console.log(`  ${u.username} (id: ${u.id})`);
    }
    return;
  }

  throw new Error('Usage: node server/cli.js <add-user|remove-user|list-users> ...');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
