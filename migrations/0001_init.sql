CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder TEXT NOT NULL DEFAULT 'inbox',
  sender TEXT,
  recipient TEXT,
  subject TEXT,
  body TEXT,
  message_id TEXT,
  date TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  replied INTEGER NOT NULL DEFAULT 0
);
