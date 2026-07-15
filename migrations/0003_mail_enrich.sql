ALTER TABLE emails ADD COLUMN from_name TEXT;
ALTER TABLE emails ADD COLUMN reply_to TEXT;
ALTER TABLE emails ADD COLUMN in_reply_to TEXT;
ALTER TABLE emails ADD COLUMN body_html TEXT;
