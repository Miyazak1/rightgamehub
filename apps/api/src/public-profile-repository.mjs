import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const profileSelect = `SELECT u.id,u.profile_handle,u.display_name,u.bio,u.profile_about,u.social_visibility,u.profile_library_visibility,
  u.profile_collaboration_status,u.profile_skills,u.profile_activity_visibility,u.profile_achievements_visibility,u.can_publish,u.role,u.created_at,
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

const publicLibrarySql = `SELECT w.*,u.display_name AS creator_display_name,u.profile_handle AS creator_handle,
  COALESCE(e.play_count,0) AS play_count,COALESCE(e.save_count,0) AS save_count,
  t.target_key,t.state AS target_state,t.current_release_id,t.revision AS target_revision,
  r.package_type,r.label AS release_label,r.os AS release_os,r.arch AS release_arch,
  r.artifact_sha256 AS release_sha256,ru.file_name AS release_file_name,ru.actual_bytes AS release_size_bytes,
  NULL::smallint AS featured_position
 FROM user_library library
 JOIN works w ON w.id::text=library.work_key
 JOIN users u ON u.id=w.owner_user_id
 JOIN work_targets t ON t.work_id=w.id
 JOIN releases r ON r.id=t.current_release_id AND r.work_id=t.work_id AND r.target_key=t.target_key
 JOIN upload_jobs ru ON ru.id=r.upload_job_id
 LEFT JOIN LATERAL (SELECT COALESCE(SUM(play_count),0)::integer AS play_count,COUNT(*) FILTER (WHERE saved_at IS NOT NULL)::integer AS save_count FROM user_library WHERE work_key=w.id::text) e ON true
 WHERE library.user_id=$1 AND library.saved_at IS NOT NULL
   AND w.state='published' AND w.visibility='public' AND t.state='published'
   AND r.validation_state='ready' AND r.serving_state='enabled'
 ORDER BY library.saved_at DESC,w.id,t.target_key`;

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
    const libraryVisible = profile.is_me || profile.profile_library_visibility === 'public' || (profile.profile_library_visibility === 'followers' && profile.is_following);
    const activityVisible = profile.is_me || profile.profile_activity_visibility === 'public' || (profile.profile_activity_visibility === 'followers' && profile.is_following);
    const achievementsVisible = profile.is_me || profile.profile_achievements_visibility === 'public' || (profile.profile_achievements_visibility === 'followers' && profile.is_following);
    const [links, works, library, savedKeys, githubRepositories, contributions, activity, achievementMetrics] = await Promise.all([
      client.query('SELECT kind,label,url,position FROM user_profile_links WHERE user_id=$1 ORDER BY position', [profile.id]),
      client.query(publicWorksSql, [profile.id]),
      libraryVisible ? client.query(publicLibrarySql, [profile.id]) : Promise.resolve({ rows: [] }),
      libraryVisible ? client.query('SELECT work_key FROM user_library WHERE user_id=$1 AND saved_at IS NOT NULL ORDER BY saved_at DESC', [profile.id]) : Promise.resolve({ rows: [] }),
      client.query(`SELECT r.id,r.owner_login,r.name,r.html_url,p.position
        FROM user_profile_github_repositories p
        JOIN github_source_repositories r ON r.id=p.source_repository_id
        JOIN github_source_connections c ON c.id=r.connection_id
        WHERE p.user_id=$1 AND c.user_id=$1 AND c.status='active' AND r.access_state='active' AND r.visibility='public'
        ORDER BY p.position`, [profile.id]),
      client.query(`SELECT t.id AS task_id,t.title,t.work_id,w.title AS work_title,t.repository_url,t.issue_url,t.submission_url,t.completed_at
        FROM contribution_tasks t JOIN works w ON w.id=t.work_id
        WHERE t.claimant_user_id=$1 AND t.status='completed' AND t.submission_url IS NOT NULL
          AND w.state='published' AND w.visibility='public'
        ORDER BY t.completed_at DESC,t.id DESC LIMIT 20`, [profile.id]),
      activityVisible ? client.query(
        `SELECT * FROM (
           SELECT 'work_published'::text AS type,w.first_published_at AS occurred_at,w.title,w.id AS work_id
             FROM works w WHERE w.owner_user_id=$1 AND w.state='published' AND w.visibility='public' AND w.first_published_at IS NOT NULL
           UNION ALL
           SELECT 'guess_baike_completed'::text AS type,r.completed_at AS occurred_at,'完成猜百科 · ' || r.puzzle_date::text AS title,NULL::uuid AS work_id
             FROM guess_baike_results r WHERE r.user_id=$1
         ) events ORDER BY occurred_at DESC LIMIT 12`, [profile.id]) : Promise.resolve({ rows: [] }),
      achievementsVisible ? this.getAchievementMetrics(profile.id, client) : Promise.resolve(null),
    ]);
    return { profile, links: links.rows, workRows: works.rows, libraryWorkRows: library.rows, libraryWorkKeys: savedKeys.rows.map(row => row.work_key), libraryVisible, githubRepositories: githubRepositories.rows, contributions: contributions.rows, activityVisible, activity: activity.rows, achievementsVisible, achievementMetrics };
  }

  async getAchievementMetrics(userId, client = this.pool) {
    const [dates, challenges, ranking] = await Promise.all([
      client.query('SELECT puzzle_date FROM guess_baike_results WHERE user_id=$1 ORDER BY puzzle_date', [userId]),
      client.query(
        `SELECT count(*) FILTER (WHERE p.completed_at IS NOT NULL)::int AS completed,
          count(*) FILTER (WHERE p.completed_at IS NOT NULL AND ((c.creator_user_id=$1 AND p.participant_outcome='loss') OR (p.participant_user_id=$1 AND p.participant_outcome='win')))::int AS wins
         FROM game_challenges c LEFT JOIN challenge_participations p ON p.challenge_id=c.id
         WHERE c.creator_user_id=$1 OR p.participant_user_id=$1`, [userId]),
      client.query(
        `WITH ranked AS (
           SELECT user_id,puzzle_date,dense_rank() OVER (PARTITION BY puzzle_date ORDER BY hints,guessed_count,elapsed_seconds,completed_at,user_id)::int AS rank
             FROM guess_baike_results
         )
         SELECT min(rank)::int AS best_rank,(array_agg(rank ORDER BY puzzle_date DESC))[1]::int AS latest_rank,
                (array_agg(puzzle_date ORDER BY puzzle_date DESC))[1] AS latest_date
           FROM ranked WHERE user_id=$1`, [userId]),
    ]);
    return {
      dates: dates.rows.map(row => String(row.puzzle_date).slice(0, 10)),
      completedChallenges: Number(challenges.rows[0]?.completed ?? 0), challengeWins: Number(challenges.rows[0]?.wins ?? 0),
      bestDailyRank: ranking.rows[0]?.best_rank ?? null, latestDailyRank: ranking.rows[0]?.latest_rank ?? null,
      latestRankDate: ranking.rows[0]?.latest_date ? String(ranking.rows[0].latest_date).slice(0, 10) : null,
    };
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
        if (input.githubRepositoryIds.length) {
          const eligible = (await client.query(
            `SELECT r.id FROM github_source_repositories r JOIN github_source_connections c ON c.id=r.connection_id
              WHERE c.user_id=$1 AND c.status='active' AND r.id=ANY($2::uuid[]) AND r.access_state='active' AND r.visibility='public'`,
            [input.userId, input.githubRepositoryIds],
          )).rows.map(row => row.id);
          if (eligible.length !== input.githubRepositoryIds.length) return { error: 'github_repository_invalid' };
        }
        await client.query(
          `UPDATE users SET profile_handle=$2,bio=$3,profile_about=$4,social_visibility=$5,profile_library_visibility=$6,
            profile_collaboration_status=COALESCE($7,profile_collaboration_status),profile_skills=COALESCE($8,profile_skills),
            profile_activity_visibility=COALESCE($9,profile_activity_visibility),profile_achievements_visibility=COALESCE($10,profile_achievements_visibility),updated_at=$11
            WHERE id=$1 AND status='active'`,
          [input.userId, input.handle, input.headline, input.about, input.visibility, input.libraryVisibility, input.collaborationStatus, input.skills, input.activityVisibility, input.achievementsVisibility, input.now],
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
        await client.query('DELETE FROM user_profile_github_repositories WHERE user_id=$1', [input.userId]);
        for (const [position, repositoryId] of input.githubRepositoryIds.entries()) await client.query(
          'INSERT INTO user_profile_github_repositories(user_id,source_repository_id,position,created_at) VALUES ($1,$2,$3,$4)',
          [input.userId, repositoryId, position, input.now],
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
