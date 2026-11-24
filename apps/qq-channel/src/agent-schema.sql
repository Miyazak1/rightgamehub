CREATE TABLE IF NOT EXISTS mooyu_qq.agent_links (
 channel_id text NOT NULL, message_id text NOT NULL,
 request_id uuid NOT NULL, interaction_id uuid, task_id uuid,
 task_settled boolean NOT NULL DEFAULT false, next_poll_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(channel_id,message_id),
 FOREIGN KEY(channel_id,message_id) REFERENCES mooyu_qq.messages(channel_id,message_id)
);
CREATE TABLE IF NOT EXISTS mooyu_qq.agent_deliveries (
 channel_id text NOT NULL, message_id text NOT NULL, source_message_id text NOT NULL,
 PRIMARY KEY(channel_id,message_id),
 FOREIGN KEY(channel_id,message_id) REFERENCES mooyu_qq.messages(channel_id,message_id),
 FOREIGN KEY(channel_id,source_message_id) REFERENCES mooyu_qq.messages(channel_id,message_id)
);
CREATE TABLE IF NOT EXISTS mooyu_qq.agent_image_pages (
 channel_id text NOT NULL,message_id text NOT NULL,task_id uuid NOT NULL,revision_id uuid NOT NULL,
 page_no integer NOT NULL CHECK(page_no BETWEEN 0 AND 23),page_count integer NOT NULL CHECK(page_count BETWEEN 1 AND 24),
 image_data bytea NOT NULL CHECK(octet_length(image_data)<=1048576),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(channel_id,message_id),UNIQUE(channel_id,task_id,page_no),
 FOREIGN KEY(channel_id,message_id) REFERENCES mooyu_qq.messages(channel_id,message_id),CHECK(page_no<page_count)
);
