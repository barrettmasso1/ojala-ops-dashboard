#!/usr/bin/env python3
"""Native, receipt-based local-detection synchronization. No browser or AI calls.

Disabled by default. A published protocol capability must be verified before any
credential or observation is sent. 401/403 create a local hold; uncertain writes
are reconciled by receipt, not repeated blindly. Legacy transport holds are never
modified. This syncs detection records, not image bytes or certified deliveries.
"""
from __future__ import annotations
import argparse,fcntl,json,os,signal,sqlite3,stat,sys,time,urllib.request,urllib.error
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from ledger import Ledger,InvalidEvidence,canonical,digest,require,parse_aware
from collector import atomic
PROTOCOL='ojala_local_cup_ledger_v1'
RECEIPT='ojala_local_cup_ledger_receipt_v1'
ORIGIN='https://ojaladarsh-m6piugsr.manus.space'

class SyncError(ValueError):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class NativeHttp:
    def __init__(self,origin,key_file,store_id):
        require(origin==ORIGIN,'unapproved_api_origin');self.origin=origin;self.key_file=Path(key_file);self.store_id=store_id
        self.opener=urllib.request.build_opener(NoRedirect())
    def _key(self):
        fd=os.open(self.key_file,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd) as f:
            info=os.fstat(f.fileno());require(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and info.st_mode&0o077==0,'private_key_permissions')
            data=json.load(f)
        require(data.get('storeId')==self.store_id and data.get('endpoint')==ORIGIN+'/api/trpc/frigate.submitCounts','credential_scope_mismatch')
        value=data.get('apiKey');require(isinstance(value,str) and bool(value.strip()),'machine_credential_missing');return value
    def _request(self,method,procedure,data=None):
        body=None if data is None else canonical({'json':data}).encode()
        req=urllib.request.Request(self.origin+'/api/trpc/'+procedure,data=body,method=method,headers={'Accept':'application/json','Content-Type':'application/json','User-Agent':'Ojala-Local-Cup-Engine/1.0'})
        try:
            with self.opener.open(req,timeout=50) as r:
                raw=r.read(256001);require(r.status==200 and len(raw)<=256000,'response_size_or_status')
                doc=json.loads(raw);return doc['result']['data']['json']
        except urllib.error.HTTPError as exc:
            code=exc.code;exc.close();raise SyncError('http_'+str(code)) from None
        except (urllib.error.URLError,TimeoutError,OSError,KeyError,ValueError):raise SyncError('network_or_response_uncertain') from None
    def capabilities(self):return self._request('GET','frigate.localLedgerCapabilities')
    def send(self,envelope):return self._request('POST','frigate.submitLocalCupLedger',{'apiKey':self._key(),**envelope})
    def receipt(self,device,day):return self._request('POST','frigate.localCupLedgerReceipt',{'apiKey':self._key(),'businessDate':day,'deviceId':device}).get('receipt')

def build_document(ledger,day,device):
    records=[]
    for row in ledger.db.execute('SELECT payload,revision,payload_sha FROM observations WHERE day=? ORDER BY id',(day,)):
        value=json.loads(row['payload']);require(value['deviceId']==device,'ledger_device_mismatch')
        records.append({'revision':row['revision'],'payloadJson':row['payload'],'payloadSha256':row['payload_sha']})
    require(len(records)<=2000,'document_record_limit_no_silent_truncation')
    text=canonical({'schemaVersion':1,'protocol':PROTOCOL,'deviceId':device,'cameraName':'handoff','businessDate':day,'records':records})
    require(len(text.encode())<=4*1024*1024,'document_size_limit');return text

def validate_receipt(receipt,envelope,store_id,device,day):
    require(isinstance(receipt,dict) and receipt.get('protocol')==RECEIPT,'receipt_protocol')
    require(receipt.get('persisted') is True and receipt.get('externalAiInvoked') is False and receipt.get('physicalDeliveryCountCreated') is False and receipt.get('countsAreSales') is False,'receipt_scope')
    expected={'storeId':store_id,'deviceId':device,'businessDate':day,'cameraName':'handoff','sequence':envelope['sequence'],'documentSha256':envelope['documentSha256'],'observationsPersisted':len(json.loads(envelope['documentJson'])['records'])}
    for k,v in expected.items():
        require(receipt.get(k)==v and (type(receipt[k]) is int if type(v) is int else isinstance(receipt[k],str)),'receipt_identity_'+k)
    at=parse_aware(receipt.get('receivedAt'));require(at.timestamp()<=time.time()+120,'receipt_future_time')
    return receipt

class Sync:
    def __init__(self,ledger,config,transport):
        self.ledger=ledger;self.config=config;self.transport=transport;self.db=ledger.db
        self.db.execute('CREATE TABLE IF NOT EXISTS native_sync(day TEXT PRIMARY KEY,sequence INTEGER NOT NULL,document_sha TEXT NOT NULL,document_json TEXT NOT NULL,status TEXT NOT NULL,receipt TEXT,last_error TEXT)');self.db.commit()
        columns={r[1] for r in self.db.execute('PRAGMA table_info(native_sync)')}
        for name,definition in [('attempts','INTEGER NOT NULL DEFAULT 0'),('dispatched_at','REAL'),('absent_readbacks','INTEGER NOT NULL DEFAULT 0')]:
            if name not in columns:self.db.execute('ALTER TABLE native_sync ADD COLUMN '+name+' '+definition)
        self.db.commit()
    def prepare(self,day):
        text=build_document(self.ledger,day,self.config['deviceId']);h=digest(text)
        old=self.db.execute('SELECT * FROM native_sync WHERE day=?',(day,)).fetchone()
        if old and old['status'] in ('delivery_unknown','blocked'):
            return {'sequence':old['sequence'],'documentJson':old['document_json'],'documentSha256':old['document_sha']},old['status']
        if old and old['document_sha']==h:
            return {'sequence':old['sequence'],'documentJson':text,'documentSha256':h},old['status']
        seq=old['sequence']+1 if old else 1
        with self.db:self.db.execute('INSERT INTO native_sync(day,sequence,document_sha,document_json,status) VALUES(?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET sequence=excluded.sequence,document_sha=excluded.document_sha,document_json=excluded.document_json,status=excluded.status,receipt=NULL,last_error=NULL,attempts=0,dispatched_at=NULL,absent_readbacks=0',(day,seq,h,text,'pending'))
        return {'sequence':seq,'documentJson':text,'documentSha256':h},'pending'
    def acknowledge(self,day,envelope,receipt):
        validate_receipt(receipt,envelope,self.config['storeId'],self.config['deviceId'],day)
        for item in json.loads(envelope['documentJson'])['records']:
            value=json.loads(item['payloadJson'])
            child={'protocol':'ojala_local_cup_receipt_v1','observationId':value['observationId'],'revision':item['revision'],'payloadSha256':item['payloadSha256'],'persisted':True,'externalAiInvoked':False,'physicalDeliveryCountCreated':False,'parentLedgerReceiptSha256':digest(canonical(receipt))}
            current=self.db.execute('SELECT revision,payload_sha FROM outbox WHERE id=?',(value['observationId'],)).fetchone()
            if current and current['revision']==item['revision'] and current['payload_sha']==item['payloadSha256']:self.ledger.acknowledge(value['observationId'],child)
        with self.db:self.db.execute('UPDATE native_sync SET status=?,receipt=?,last_error=NULL WHERE day=?',('acknowledged',canonical(receipt),day))
    def cycle(self,day):
        if self.config.get('networkEnabled') is not True:return {'status':'disabled','networkAttempted':False}
        envelope,state=self.prepare(day)
        if state=='acknowledged':return {'status':'acknowledged','networkAttempted':False,'sequence':envelope['sequence']}
        if state=='blocked':return {'status':'blocked_requires_supported_access','networkAttempted':False}
        try:
            capability=self.transport.capabilities()
            require(capability.get('protocol')==PROTOCOL and capability.get('externalAiRequired') is False and capability.get('browserRequired') is False and capability.get('scopedByCredential') is True and capability.get('persistedReadbackRequired') is True,'server_protocol_not_ready')
            if state=='delivery_unknown':
                receipt=self.transport.receipt(self.config['deviceId'],day)
                if receipt is None:
                    row=self.db.execute('SELECT attempts,dispatched_at,absent_readbacks FROM native_sync WHERE day=?',(day,)).fetchone()
                    missing=row['absent_readbacks']+1
                    settled=row['dispatched_at'] is not None and time.time()-row['dispatched_at']>=120 and missing>=2
                    new_state='blocked' if settled and row['attempts']>=3 else 'pending' if settled else 'delivery_unknown'
                    reason='retry_limit_after_verified_absence' if new_state=='blocked' else 'readback_confirmed_absent' if settled else 'awaiting_settled_readback'
                    with self.db:self.db.execute('UPDATE native_sync SET status=?,absent_readbacks=?,last_error=? WHERE day=?',(new_state,missing,reason,day))
                    return {'status':new_state,'networkAttempted':True,'resent':False,'retryAllowedAfterVerifiedAbsence':new_state=='pending'}
            else:
                with self.db:self.db.execute('UPDATE native_sync SET status=?,attempts=attempts+1,dispatched_at=?,absent_readbacks=0 WHERE day=?',('delivery_unknown',time.time(),day))
                reply=self.transport.send(envelope);require(reply.get('success') is True,'application_did_not_confirm');receipt=reply.get('receipt')
            self.acknowledge(day,envelope,receipt)
            return {'status':'acknowledged','sequence':envelope['sequence'],'networkAttempted':True,'receipt':receipt}
        except (SyncError,InvalidEvidence) as exc:
            reason=str(exc)
            if reason in ('http_301','http_302','http_303','http_307','http_308','http_400','http_401','http_403','http_404','http_405','http_409','private_key_permissions','credential_scope_mismatch','machine_credential_missing') or reason.startswith('receipt_') or reason=='server_protocol_not_ready':
                with self.db:self.db.execute('UPDATE native_sync SET status=?,last_error=? WHERE day=?',('blocked',reason,day))
                status='blocked'
            else:
                with self.db:self.db.execute('UPDATE native_sync SET last_error=? WHERE day=?',(reason,day))
                status=self.db.execute('SELECT status FROM native_sync WHERE day=?',(day,)).fetchone()[0]
            return {'status':status,'reason':reason,'networkAttempted':True,'blindRetryAllowed':False}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',required=True,type=Path);p.add_argument('--daemon',action='store_true');a=p.parse_args();os.umask(0o077)
    c=json.loads(a.config.read_text());root=Path(c['stateRoot']);sys.path.insert(0,str(Path(c['basePath'])/'manus-bridge'));from package_storage import verify_external
    verify_external(Path(c['basePath']),root,writable=True,required_bytes=32*1024*1024)
    with (root/'sync.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);ledger=Ledger(root/'ledger.sqlite3');sync=Sync(ledger,c,NativeHttp(c['apiOrigin'],c['machineCredentialFile'],c['storeId']));stop=[False]
        def finish(*_):stop[0]=True
        signal.signal(signal.SIGTERM,finish);signal.signal(signal.SIGINT,finish)
        try:
            while not stop[0]:
                verify_external(Path(c['basePath']),root,writable=True,required_bytes=32*1024*1024)
                days=[r[0] for r in ledger.db.execute('SELECT DISTINCT day FROM observations ORDER BY day DESC')]
                results=[{'businessDate':day,**sync.cycle(day)} for day in days[:14]]
                report={'checkedAt':datetime.now(timezone.utc).isoformat(),'transport':'native_authenticated_api','browserRequired':False,'externalAiRequired':False,'physicalDeliveryCountCreated':False,'deferredHistoricalDays':days[14:],'results':results}
                atomic(root/'sync-health.json',report)
                if not a.daemon:print(canonical(report),flush=True);break
                for _ in range(20):
                    if stop[0]:break
                    time.sleep(.25)
        finally:ledger.close()
if __name__=='__main__':main()
