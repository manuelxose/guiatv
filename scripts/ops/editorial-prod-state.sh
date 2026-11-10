#!/usr/bin/env bash
# Read-only snapshot of the editorial flow in production (no writes, never prints a credential).
#   ssh contabo 'bash -s' < scripts/ops/editorial-prod-state.sh
set -u
ENV=/etc/guiatv/api.env
val() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
U=$(val MONGODB_URI); D=$(val MONGODB_DB_NAME)
echo "== release $(readlink -f /var/www/guiatv/current)"
S=$(val EDITORIAL_RUNNER_STATE_DIR)
echo "== runner pid: $(cat "$S/editorial-runner.pid" 2>/dev/null)"; ps -eo pid,etime,args | grep editorial-agents | grep -v grep
echo "== schedulers"; crontab -l 2>/dev/null | grep -i editorial; systemctl list-timers --all --no-pager 2>/dev/null | grep -i editorial
mongosh --quiet "$U" --eval "
const d = db.getSiblingDB('$D'); const p = (x) => print(EJSON.stringify(x, null, 0));
print('== settings'); p(d.editorial_settings.find({}, {'settings.routes':0}).toArray());
print('== runner'); p(d.editorial_runner.find().toArray());
print('== cycles'); p(d.editorial_cycles.find({}, {_id:0}).sort({at:-1}).limit(5).toArray());
print('== requests'); p(d.editorial_generation_requests.aggregate([{\$group:{_id:{k:'\$kind',s:'\$status'},n:{\$sum:1},last:{\$max:'\$updatedAt'}}}]).toArray());
print('== open requests'); p(d.editorial_generation_requests.find({status:{\$in:['queued','running','failed']}}, {_id:0,id:1,kind:1,status:1,reason:1,claimedAt:1,updatedAt:1,'topic.slug':1}).sort({updatedAt:-1}).limit(8).toArray());
print('== ai posts'); p(d.blog_posts.find({origin:'ai-assisted'}, {slug:1,status:1,reviewState:1,reviewedBy:1,'editorial.state':1,'editorial.draftHash':1,updatedAt:1}).sort({updatedAt:-1}).limit(15).toArray());
print('== approvals'); p(d.editorial_policy_approvals.find().sort({at:-1}).limit(8).toArray());
print('== jobs (ledger)'); p(d.editorial_job_ledger ? d.getCollection('editorial_job_ledger').find({}, {_id:0,jobId:1,slug:1,state:1,'lease.expiresAt':1,updatedAt:1}).sort({updatedAt:-1}).limit(6).toArray() : []);
print('== editorial collections'); p(d.getCollectionNames().filter(n => /editorial/.test(n)).sort());
"
