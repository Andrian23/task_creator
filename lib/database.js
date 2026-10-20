import postgres from 'postgres';

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
let sql;
let schemaPromise;

function client() {
  if (!connectionString) return null;
  if (!sql) sql = postgres(connectionString, { ssl: 'require', max: 1, idle_timeout: 10 });
  return sql;
}

async function ensureSchema() {
  const database = client();
  if (!database) return null;
  if (!schemaPromise) {
    schemaPromise = database.begin(async (transaction) => {
      await transaction`CREATE TABLE IF NOT EXISTS clickup_projects (
        task_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await transaction`CREATE TABLE IF NOT EXISTS upwork_rooms (
        room_id TEXT PRIMARY KEY,
        topic TEXT,
        url TEXT,
        clickup_task_id TEXT REFERENCES clickup_projects(task_id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await transaction`CREATE TABLE IF NOT EXISTS upwork_messages (
        id BIGSERIAL PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        room_id TEXT NOT NULL REFERENCES upwork_rooms(room_id),
        external_message_id TEXT,
        author TEXT,
        direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
        body TEXT NOT NULL,
        message_timestamp TEXT,
        source_url TEXT,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await transaction`CREATE INDEX IF NOT EXISTS upwork_messages_room_received_idx
        ON upwork_messages(room_id, received_at DESC)`;
    });
  }
  await schemaPromise;
  return database;
}

export function isDatabaseConfigured() {
  return Boolean(connectionString);
}

export async function storeUpworkMessage(event, fingerprint) {
  const database = await ensureSchema();
  if (!database) return { stored: false, reason: 'DATABASE_NOT_CONFIGURED' };
  await database.begin(async (transaction) => {
    await transaction`INSERT INTO upwork_rooms (room_id, topic, url)
      VALUES (${event.roomId}, ${event.topic || null}, ${event.url || null})
      ON CONFLICT (room_id) DO UPDATE SET
        topic = COALESCE(EXCLUDED.topic, upwork_rooms.topic),
        url = COALESCE(EXCLUDED.url, upwork_rooms.url),
        updated_at = NOW()`;
    await transaction`INSERT INTO upwork_messages (
        fingerprint, room_id, external_message_id, author, direction, body, message_timestamp, source_url
      ) VALUES (
        ${fingerprint}, ${event.roomId}, ${event.messageId || null}, ${event.author || null},
        ${event.direction}, ${event.message}, ${event.timestamp || null}, ${event.url || null}
      ) ON CONFLICT (fingerprint) DO NOTHING`;
  });
  return { stored: true };
}

export async function storeUpworkHistory(entries) {
  if (!entries.length) return { stored: 0 };
  const database = await ensureSchema();
  if (!database) return { stored: 0, reason: 'DATABASE_NOT_CONFIGURED' };
  const latest = entries.at(-1).event;
  const rows = entries.map(({ event, fingerprint }) => ({
    fingerprint,
    room_id: event.roomId,
    external_message_id: event.messageId || null,
    author: event.author || null,
    direction: event.direction,
    body: event.message,
    message_timestamp: event.timestamp || null,
    source_url: event.url || null,
  }));
  await database.begin(async (transaction) => {
    await transaction`INSERT INTO upwork_rooms (room_id, topic, url)
      VALUES (${latest.roomId}, ${latest.topic || null}, ${latest.url || null})
      ON CONFLICT (room_id) DO UPDATE SET
        topic = COALESCE(EXCLUDED.topic, upwork_rooms.topic),
        url = COALESCE(EXCLUDED.url, upwork_rooms.url),
        updated_at = NOW()`;
    await transaction`INSERT INTO upwork_messages ${transaction(rows,
      'fingerprint', 'room_id', 'external_message_id', 'author', 'direction',
      'body', 'message_timestamp', 'source_url')}
      ON CONFLICT (fingerprint) DO NOTHING`;
  });
  return { stored: rows.length };
}

export async function storeRoomProjectMapping(roomId, project, event = {}) {
  const database = await ensureSchema();
  if (!database) return { stored: false, reason: 'DATABASE_NOT_CONFIGURED' };
  await database.begin(async (transaction) => {
    await transaction`INSERT INTO clickup_projects (task_id, name, url)
      VALUES (${project.id}, ${project.name}, ${project.url || null})
      ON CONFLICT (task_id) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, updated_at = NOW()`;
    await transaction`INSERT INTO upwork_rooms (room_id, topic, url, clickup_task_id)
      VALUES (${roomId}, ${event.topic || project.name}, ${event.url || null}, ${project.id})
      ON CONFLICT (room_id) DO UPDATE SET
        clickup_task_id = EXCLUDED.clickup_task_id,
        topic = COALESCE(EXCLUDED.topic, upwork_rooms.topic),
        url = COALESCE(EXCLUDED.url, upwork_rooms.url),
        updated_at = NOW()`;
  });
  return { stored: true };
}
