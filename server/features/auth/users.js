'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const {
  listUsersFromDb,
  getUserByUsername,
  insertUser,
  deleteUserByUsername,
} = require('../../db');

const USERNAME_RE = /^[a-zA-Z0-9_.-]{1,50}$/;

async function listUsers() {
  return listUsersFromDb();
}

async function addUser(username, password) {
  const name = String(username || '').trim();
  if (!USERNAME_RE.test(name)) {
    throw new Error('Username must be 1-50 chars using letters, numbers, ., _, or -');
  }

  const pwd = String(password || '');
  if (pwd.length < 8) throw new Error('Password must be at least 8 characters');

  const existing = await getUserByUsername(name);
  if (existing) {
    throw new Error('User already exists');
  }

  const passwordHash = await bcrypt.hash(pwd, 10);
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    username: name,
    passwordHash,
  };

  await insertUser(user);
  return { id: user.id, username: user.username };
}

async function removeUser(username) {
  const name = String(username || '').trim().toLowerCase();
  const existing = await getUserByUsername(name);
  if (!existing) throw new Error('User not found');

  const changes = await deleteUserByUsername(name);
  if (!changes) throw new Error('User not found');

  return { id: existing.id, username: existing.username };
}

async function verifyUser(username, password) {
  const name = String(username || '').trim();
  const user = await getUserByUsername(name);
  if (!user) return null;

  const ok = await bcrypt.compare(String(password || ''), String(user.passwordHash || ''));
  if (!ok) return null;

  return { id: user.id, username: user.username };
}

module.exports = {
  listUsers,
  addUser,
  removeUser,
  verifyUser,
};
