import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const profileSelect = `SELECT u.id,u.profile_handle,u.display_name,u.bio,u.profile_about,u.social_visibility,u.can_publish,u.role,u.created_at,
  a.kind AS avatar_kind,a.preset_key,a.media_type,a.sha256,a.animated,a.poster_body,a.poster_key,
  (SELECT count(*) FROM user_follows f WHERE f.followed_user_id=u.id)::int AS follower_count,
  (SELECT count(*) FROM user_follows f WHERE f.follower_user_id=u.id)::int AS following_count,
  CASE WHEN $1::uuid IS NULL THEN false ELSE EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=$1 AND f.followed_user_id=u.id) END AS is_following,
  CASE WHEN $1::uuid IS NULL THEN false ELSE u.id=$1 END AS is_me`;

const publicWorksSql = `SELECT w.*,u.display_name AS creator_display_name,u.profile_handle AS creator_handle,
  COALESCE(e.play_count,0) AS play_count,COALESCE(e.save_count,0) AS save_count,
  t.target_key,t.state AS target_state,t.current_release_id,t.revision AS target_revision,
  r.package_type,r.label AS release_label,r.os AS release_os,r.arch AS release_arch,
  r.artifact_sha256 AS release_sha256,ru.file_name AS release_file_name,ru.actual_bytes AS release_size_bytes,
  fw.position AS featured_position
 FROM works w
 JOIN users u ON u.id=w.owner_user_id
 JOIN work_targets t ON t.work_id=w.id
 JOIN releases r ON r.id=t.current_release_id AND r.work_id=t.work_id AND r.target_key=t.target_key
 JOIN upload_jobs ru ON ru.id=r.upload_job_id
 LEFT JOIN user_featured_works fw ON fw.user_id=w.owner_user_id AND fw.work_id=w.id
 LEFT JOIN LATERAL (SELECT COALESCE(SUM(play_count),0)::integer AS play_count,COUNT(*) FILTER (WHERE saved_at IS NOT NULL)::integer AS save_count FROM user_library WHERE work_key=w.id::text) e ON true
 WHERE w.owner_user_id=$1 AND w.state='published' AND w.visibility='public' AND t.state='published'
   AND r.validation_state='ready' AND r.serving_state='enabled'
 ORDER BY fw.position NULLS LAST,w.first_published_at DESC,w.id,t.target_key`;

export class PostgresPublicProfileRepository {
  constructor(pool) { this.pool = pool; }

  async getByHandle(viewerId, handle, client = this.pool) {
    const profile = (await client.query(
      `${profileSelect} FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id
       WHERE lower(u.profile_handle)=lower($2) AND u.status='active'
         AND ($1::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=u.id) OR (b.blocker_user_id=u.id AND b.blocked_user_id=$1)))
         AND (u.social_visibility='public' OR u.id=$1 OR (u.social_visibility='followers' AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=$1 AND f.followed_user_id=u.id)))`,
      [viewerId, handle],
    )).rows[0];
    if (!profile) return null;
    const [links, works] = await Promise.all([
      client.query('SELECT kind,label,url,position FROM user_profile_links WHERE user_id=$1 ORDER BY position', [profile.id]),
      client.query(publicWorksSql, [profile.id]),
    ]);
    return { profile, links: links.rows, workRows: works.rows };
  }

  async update(input) {
    return withTransaction(this.pool, async client => {
      try {
        if (input.featuredWorkIds.length) {
          const eligible = (await client.query(
            `SELECT DISTINCT w.id FROM works w JOIN work_targets t ON t.work_id=w.id JOIN releases r ON r.id=t.current_release_id
              WHERE w.owner_user_id=$1 AND w.id=ANY($2::uuid[]) AND w.state='published' AND w.visibility='public'
                AND t.state='published' AND r.validation_state='ready' AND r.serving_state='enabled'`,
            [input.userId, input.featuredWorkIds],
          )).rows.map(row => row.id);
          if (eligible.length !== input.featuredWorkIds.length) return { error: 'featured_work_invalid' };
        }
        await client.query(
          `UPDATE users SET profile_handle=$2,bio=$3,profile_about=$4,social_visibility=$5,updated_at=$6
            WHERE id=$1 AND status='active'`,
          [input.userId, input.handle, input.headline, input.about, input.visibility, input.now],
        );
        await client.query('DELETE FROM user_profile_links WHERE user_id=$1', [input.userId]);
        for (const [position, link] of input.links.entries()) await client.query(
          'INSERT INTO user_profile_links(id,user_id,kind,label,url,position,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)',
          [crypto.randomUUID(), input.userId, link.kind, link.label, link.url, position, input.now],
        );
        await client.query('DELETE FROM user_featured_works WHERE user_id=$1', [input.userId]);
        for (const [position, workId] of input.featuredWorkIds.entries()) await client.query(
          'INSERT INTO user_featured_works(user_id,work_id,position,created_at) VALUES ($1,$2,$3,$4)',
          [input.userId, workId, position, input.now],
        );
        const handle = (await client.query('SELECT profile_handle FROM users WHERE id=$1', [input.userId])).rows[0]?.profile_handle;
        return this.getByHandle(input.userId, handle, client);
      } catch (error) {
        if (error?.code === '23505' && String(error.constraint || '').includes('profile_handle')) return { error: 'handle_taken' };
        throw error;
      }
    });
  }
}
