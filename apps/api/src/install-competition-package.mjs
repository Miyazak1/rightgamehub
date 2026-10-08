import crypto from 'node:crypto';
import {Readable} from 'node:stream';

// Operator-only deployment helper. Uses the same upload, quota and validation pipeline as creators.
export async function installCompetitionPackage({runtime,workId,bytes,provenance,wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds))}) {
  const pool=runtime.database.pool,digest=crypto.createHash('sha256').update(bytes).digest('hex');
  if(digest!==provenance.sha256)throw new Error('Bundled game package checksum mismatch.');
  const work=(await pool.query('SELECT id,owner_user_id,repository_url,state FROM works WHERE id=$1',[workId])).rows[0];
  if(!work||work.repository_url!==provenance.repository||work.state!=='published')throw new Error('Expected published 2048 source work was not found; no game was changed.');
  const previous=(await pool.query("SELECT t.current_release_id,r.artifact_sha256 FROM work_targets t JOIN releases r ON r.id=t.current_release_id WHERE t.work_id=$1 AND t.target_key='web'",[workId])).rows[0];
  if(previous?.artifact_sha256===digest)return {workId,releaseId:previous.current_release_id,alreadyInstalled:true};
  const actor={userId:work.owner_user_id,scopes:['upload']};
  const created=await runtime.uploadService.create(actor,workId,{targetKey:'web',packageType:'web_zip',fileName:'2048-competition-v1.zip',releaseLabel:'1.1.0-competition',declaredBytes:bytes.length,sha256:digest,autoPublish:true},'competition-2048-'+digest);
  const job=await runtime.uploadService.get(actor,created.id);
  if(job.state==='created'){
    const grant=await runtime.uploadService.grant(actor,job.id);await runtime.uploadService.receive(job.id,'Upload '+grant.token,Readable.from([bytes]));
    await runtime.uploadService.complete(actor,job.id,'competition-2048-complete-'+digest);
  }else if(job.state==='uploaded')await runtime.uploadService.complete(actor,job.id,'competition-2048-complete-'+digest);
  for(let attempt=0;attempt<90;attempt++){
    const status=await runtime.uploadService.get(actor,job.id);
    if(status.state==='succeeded'){
      const release=(await pool.query('SELECT release_id,publication_outcome FROM upload_jobs WHERE id=$1',[job.id])).rows[0];
      if(release.publication_outcome!=='published')throw new Error('2048 validated but was not published: '+release.publication_outcome);
      const current=(await pool.query("SELECT current_release_id FROM work_targets WHERE work_id=$1 AND target_key='web'",[workId])).rows[0];
      if(current.current_release_id!==release.release_id)throw new Error('A newer game release is active; it was preserved.');
      return {workId,releaseId:release.release_id,previousReleaseId:previous?.current_release_id??null,packageSha256:digest,sourceCommit:provenance.commit};
    }
    if(['failed','expired'].includes(status.state))throw new Error('2048 update failed: '+status.errorCode);
    await runtime.validationWorker.runOnce({targetUploadId:job.id});await wait(1000);
  }
  throw new Error('2048 update is still processing; rerun the same update to inspect the existing job.');
}
