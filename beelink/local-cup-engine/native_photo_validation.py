"""Metadata-only automatic validation of stored native evidence.

Runs inside the existing photo worker. Never uploads image bytes, changes upload
receipts/attempts, fabricates a human decision, or turns a picture into a sale.
An uncertain finalize is read back before any retry; authorization failures hold.
"""
from __future__ import annotations
import json,time
from native_sync import SyncError
from ledger import InvalidEvidence,canonical,require,parse_aware

PROTOCOL='ojala_local_automatic_validation_v1'
MAX_ATTEMPTS=3

def validation_state(receipt,observation,store_id):
    from native_photos import validate_photo_receipt
    validate_photo_receipt(receipt,observation,store_id)
    if receipt.get('analysisStatus') in ('approved_by_manager','discarded_by_manager'):
        return 'preserved_manual'
    assessment=receipt.get('automaticValidation')
    if assessment is None:return None
    require(isinstance(assessment,dict),'auto_validation_format')
    if assessment.get('status')!='verified':return None
    require(assessment.get('protocol')==PROTOCOL,'auto_validation_protocol')
    require(assessment.get('requiredHumanAction') is False,'auto_validation_human_gate')
    require(receipt.get('analysisStatus')=='approved_by_ai','auto_validation_status_mismatch')
    # NativeHttp's parent receipt validator already binds tenant, day, device,
    # event, observation and original image bytes. The server binds the proof.
    for key,expected in [('observationId',observation['observationId']),('imageSha256',observation['sameFrameEvidence']['imageSha256'])]:
        if key in assessment:require(assessment[key]==expected,'auto_validation_binding_'+key)
    if 'externalAiInvoked' in assessment:require(assessment['externalAiInvoked'] is False,'auto_validation_external_ai')
    return 'verified'

def finalize_request(transport,observation):
    return transport._request('POST','frigate.finalizeLocalCupEvidence',{
        'apiKey':transport._key(),'deviceId':observation['deviceId'],
        'businessDate':observation['businessDate'],'observationId':observation['observationId']})

class AutomaticPhotoValidation:
    def __init__(self,db):
        self.db=db
        self.db.execute('''CREATE TABLE IF NOT EXISTS photo_auto_validation(
            id TEXT PRIMARY KEY,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
            dispatched REAL,stale_reads INTEGER NOT NULL DEFAULT 0,last_error TEXT,
            receipt TEXT,checked_at REAL)''');self.db.commit()
    def seed(self):
        with self.db:self.db.execute("INSERT OR IGNORE INTO photo_auto_validation(id,status) SELECT id,'pending' FROM photos WHERE status='acknowledged'")
    def states(self):return dict(self.db.execute('SELECT status,count(*) FROM photo_auto_validation GROUP BY status').fetchall())
    def record(self,eid,status,receipt=None,error=None):
        with self.db:self.db.execute('UPDATE photo_auto_validation SET status=?,receipt=?,last_error=?,checked_at=? WHERE id=?',
            (status,canonical(receipt) if receipt is not None else None,error,time.time(),eid))
    def cycle(self,transport,config,limit=2):
        if config.get('networkEnabled') is not True or config.get('automaticValidationEnabled') is not True:
            return {'status':'disabled','networkAttempted':False}
        require(type(limit) is int and 1<=limit<=2,'auto_validation_limit')
        self.seed();results=[]
        due=self.db.execute("SELECT v.*,p.observation FROM photo_auto_validation v JOIN photos p ON p.id=v.id WHERE v.status IN ('pending','unknown') AND p.status='acknowledged' ORDER BY p.day DESC,v.id LIMIT ?",(limit,)).fetchall()
        if not due:return {'status':'checked','networkAttempted':False,'states':self.states(),'results':[]}
        try:
            cap=transport.capabilities()
            require(cap.get('automaticValidationProtocol')==PROTOCOL and cap.get('humanApprovalRequired') is False
                    and cap.get('scopedByCredential') is True and cap.get('externalAiRequired') is False
                    and cap.get('browserRequired') is False,'auto_validation_contract_not_ready')
        except (SyncError,InvalidEvidence,OSError,ValueError) as exc:
            return {'status':'contract_unavailable','reason':str(exc) if isinstance(exc,(SyncError,InvalidEvidence)) else type(exc).__name__,'networkAttempted':True,'states':self.states()}
        for row in due:
            o=json.loads(row['observation']);eid=row['id']
            try:
                # Previously excluded/false-positive observations must never be
                # silently promoted, even though original photo is preserved.
                if o.get('sourceFalsePositive') or o.get('verification')!='same_frame_local_cv' or o.get('ownerSizeReview',{}).get('label')=='not_cup':
                    self.record(eid,'excluded',error='source_not_eligible');results.append({'id':eid,'status':'excluded','finalizeSent':False});continue
                receipt=transport.receipt(o)
                require(receipt is not None,'auto_validation_stored_photo_missing')
                state=validation_state(receipt,o,config['storeId'])
                if state:
                    self.record(eid,state,receipt);results.append({'id':eid,'status':state,'finalizeSent':False});continue
                if row['status']=='unknown':
                    stale=row['stale_reads']+1
                    settled=row['dispatched'] is not None and time.time()-row['dispatched']>=120 and stale>=2
                    status='blocked' if settled and row['attempts']>=MAX_ATTEMPTS else 'pending' if settled else 'unknown'
                    with self.db:self.db.execute('UPDATE photo_auto_validation SET status=?,stale_reads=?,last_error=?,checked_at=? WHERE id=?',
                        (status,stale,'verified_not_finalized' if settled else 'awaiting_finalization_readback',time.time(),eid))
                    results.append({'id':eid,'status':status,'finalizeSent':False});continue
                require(row['attempts']<MAX_ATTEMPTS,'auto_validation_attempt_limit')
                with self.db:self.db.execute("UPDATE photo_auto_validation SET status='unknown',attempts=attempts+1,dispatched=?,stale_reads=0,last_error=NULL WHERE id=?",(time.time(),eid))
                response=finalize_request(transport,o)
                require(response.get('success') is True,'auto_validation_not_confirmed')
                state=validation_state(response.get('receipt'),o,config['storeId'])
                require(state in ('verified','preserved_manual'),'auto_validation_not_confirmed')
                # Independent readback, not a response-body-only approval.
                saved=transport.receipt(o);confirmed=validation_state(saved,o,config['storeId'])
                require(confirmed in ('verified','preserved_manual'),'auto_validation_not_confirmed')
                self.record(eid,confirmed,saved);results.append({'id':eid,'status':confirmed,'finalizeSent':True,'readbackVerified':True})
            except (SyncError,InvalidEvidence,OSError,ValueError,KeyError,TypeError) as exc:
                reason=str(exc) if isinstance(exc,(SyncError,InvalidEvidence)) else type(exc).__name__
                if len(reason)>120 or '://' in reason:reason=type(exc).__name__
                current=self.db.execute('SELECT status FROM photo_auto_validation WHERE id=?',(eid,)).fetchone()[0]
                uncertain=current=='unknown' and reason in ('http_409','http_500','http_502','http_503','network_or_response_uncertain','auto_validation_not_confirmed')
                status='unknown' if uncertain else 'pending' if reason in ('http_429','http_502','http_503','network_or_response_uncertain') else 'blocked'
                self.record(eid,status,error=reason);results.append({'id':eid,'status':status,'reason':reason,'finalizeSent':False})
                if reason in ('http_401','http_403'):
                    return {'status':'authorization_hold','holdReason':reason,'networkAttempted':True,'states':self.states(),'results':results}
        return {'status':'checked','networkAttempted':True,'states':self.states(),'results':results}
