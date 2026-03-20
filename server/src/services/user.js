const { getDatabase } = require('../db/database');

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    phone: row.phone,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    subscriptionTier: row.subscription_tier,
    subscriptionExpiresAt: row.subscription_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getUserById(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return mapUser(row);
}

function getUserByPhone(phone) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  return mapUser(row);
}

function createUser({ phone, nickname = '' }) {
  const db = getDatabase();
  const result = db
    .prepare(
      `
        INSERT INTO users (phone, nickname)
        VALUES (?, ?)
      `,
    )
    .run(phone, nickname.trim());

  return getUserById(result.lastInsertRowid);
}

function updateUserSubscription(userId, subscriptionTier, subscriptionExpiresAt = null) {
  const db = getDatabase();
  db.prepare(
    `
      UPDATE users
      SET
        subscription_tier = ?,
        subscription_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
  ).run(subscriptionTier, subscriptionExpiresAt, userId);

  return getUserById(userId);
}

module.exports = {
  createUser,
  getUserById,
  getUserByPhone,
  updateUserSubscription,
};
