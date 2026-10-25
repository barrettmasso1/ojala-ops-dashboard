"""Idempotent handoff-estimate transport. An uncertain write is READ first.
No alternate endpoints, credentials, browsers, artificial counts or silent retries.
"""
import json,sqlite3,time
from directional_core import PROTOCOL,SIZES,canonical,digest,require,timestamp
RECEIPT='ojala_directional_handoffs_receipt_v1'

def check_capabilities(c):
    require(isinstance(c,dict) and c.get('protocol')==PROTOCOL and c.get('receiptProtocol')==RECEIPT,'directional_contract_not_published')
    for k,v in {'credentialScoped':True,'browserRequired':False,'externalAiRequired':False,'requiresPersistedLocalObservation':True,'persistedReadbackRequired':True,'createsSales':False,'createsReviewedPhysicalCounts':False}.items():require(c.get(k) is v,'directional_capability_scope')

def check_receipt(r,envelope,config):
    require(isinstance(r,dict) and r.get('protocol')==RECEIPT,'directional_receipt_protocol')
    for k,v in {'persisted':True,'partial':True,'countsAreSales':False,'physicalUniqueCountCertified':False,'externalAiInvoked':False,'requiredHumanAction':False}.items():require(r.get(k) is v,'directional_receipt_scope')
    doc=json.loads(envelope['documentJson'])
    for k,v in {'storeId':config['storeId'],'deviceId':config['deviceId'],'businessDate':doc['businessDate'],'cameraName':'handoff','sequence':envelope['sequence'],'documentSha256':envelope['documentSha256'],'recordsPersisted':len(doc['records'])}.items():
        require(r.get(k)==v and (type(r.get(k)) is int if type(v) is int else isinstance(r.get(k),str)),'directional_receipt_identity_'+k)
    estimates=[x for x in doc['records'] if x['status']=='estimated'];sizes={k:0 for k in SIZES}
    for record in estimates:sizes[record['size']]+=1
    if not doc['windows']:
        require(r.get('estimatedHandoffs') is None and r.get('sizeBreakdown') is None,'unobserved_is_not_zero')
        require(r.get('observedFrom') is None and r.get('observedUntil') is None,'unobserved_interval')
    else:
        require(type(r.get('estimatedHandoffs')) is int and r['estimatedHandoffs']==len(estimates),'directional_receipt_total')
        require(r.get('sizeBreakdown')==sizes and all(type(x) is int for x in r['sizeBreakdown'].values()),'directional_receipt_sizes')
        require(timestamp(r['observedFrom'])==timestamp(doc['windows'][0]['from']) and timestamp(r['observedUntil'])==timestamp(doc['windows'][-1]['until']),'directional_receipt_interval')
    require(timestamp(r.get('receivedAt'))<=time.time()+120,'directional_receipt_future')
    return r

class Sync:
    def __init__(self,path,config,transport):
        self.config=config;self.transport=transport;self.db=sqlite3.connect(path,timeout=5);self.db.row_factory=sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS outbox(day TEXT PRIMARY KEY,sequence INTEGER NOT NULL,document_json TEXT NOT NULL,document_sha TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,dispatched REAL,checks INTEGER NOT NULL DEFAULT 0,last_error TEXT,receipt TEXT)');self.db.commit()
    def close(self):self.db.close()
    def accept(self,day,envelope,receipt):
        check_receipt(receipt,envelope,self.config)
        with self.db:self.db.execute("UPDATE outbox SET status='acknowledged',receipt=?,last_error=NULL WHERE day=?",(canonical(receipt),day))
    def cycle(self,document):
        if self.config.get('networkEnabled') is not True:return {'status':'disabled','networkAttempted':False}
        day=document['businessDate'];text=canonical(document);sha=digest(text);require(len(text.encode())<=4*1024*1024,'directional_document_limit')
        row=self.db.execute('SELECT * FROM outbox WHERE day=?',(day,)).fetchone()
        if row and row['status']=='blocked':return {'status':'blocked','reason':row['last_error'],'networkAttempted':False}
        if row and row['status']=='acknowledged' and row['document_sha']==sha:return {'status':'acknowledged','sequence':row['sequence'],'networkAttempted':False}
        if not row or row['status']=='acknowledged':
            seq=1 if row is None else row['sequence']+1
            with self.db:self.db.execute("INSERT INTO outbox(day,sequence,document_json,document_sha,status) VALUES(?,?,?,?,'pending') ON CONFLICT(day) DO UPDATE SET sequence=excluded.sequence,document_json=excluded.document_json,document_sha=excluded.document_sha,status='pending',attempts=0,dispatched=NULL,checks=0,last_error=NULL,receipt=NULL",(day,seq,text,sha))
            row=self.db.execute('SELECT * FROM outbox WHERE day=?',(day,)).fetchone()
        envelope={'sequence':row['sequence'],'documentJson':row['document_json'],'documentSha256':row['document_sha']}
        try:
            check_capabilities(self.transport.capabilities())
            receipt=self.transport.receipt(self.config['deviceId'],day)
            if receipt is not None:
                if receipt.get('sequence')==row['sequence']:
                    self.accept(day,envelope,receipt);return {'status':'acknowledged','sequence':row['sequence'],'networkAttempted':True,'uploaded':False}
                # Prior receipt belongs to an earlier acknowledged snapshot, never the current write.
                require(receipt.get('storeId')==self.config['storeId'] and receipt.get('deviceId')==self.config['deviceId'] and receipt.get('businessDate')==day and type(receipt.get('sequence')) is int,'directional_prior_receipt_scope')
                require(receipt['sequence']<row['sequence'],'directional_future_revision_conflict')
            if row['status']=='delivery_unknown':
                checks=row['checks']+1;expired=row['dispatched'] is not None and time.time()-row['dispatched']>120 and checks>=6
                status='blocked' if expired else 'delivery_unknown'
                with self.db:self.db.execute('UPDATE outbox SET status=?,checks=?,last_error=? WHERE day=?',(status,checks,'settled_without_matching_receipt' if expired else 'awaiting_matching_readback',day))
                return {'status':status,'networkAttempted':True,'uploaded':False}
            with self.db:self.db.execute("UPDATE outbox SET status='delivery_unknown',attempts=attempts+1,dispatched=?,checks=0 WHERE day=?",(time.time(),day))
            answer=self.transport.send(envelope);require(answer.get('success') is True,'directional_write_not_acknowledged')
            self.accept(day,envelope,answer.get('receipt'));return {'status':'acknowledged','sequence':row['sequence'],'networkAttempted':True,'uploaded':True}
        except (ValueError,OSError,KeyError,TypeError) as exc:
            reason=str(exc)
            if len(reason)>120 or any(t in reason.lower() for t in ['://','password','api_key','apikey','token']):reason=type(exc).__name__
            current=self.db.execute('SELECT status FROM outbox WHERE day=?',(day,)).fetchone()[0]
            uncertain=current=='delivery_unknown' and reason in ('http_409','http_500','http_502','http_503','http_504','network_or_response_uncertain','directional_write_not_acknowledged')
            state='delivery_unknown' if uncertain else 'pending' if reason=='directional_contract_not_published' else 'blocked'
            with self.db:self.db.execute('UPDATE outbox SET status=?,last_error=? WHERE day=?',(state,reason,day))
            return {'status':state,'reason':reason,'networkAttempted':True,'uploaded':False}
