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
