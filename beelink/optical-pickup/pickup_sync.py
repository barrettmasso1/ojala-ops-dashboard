"""Snapshot synchronization with an exact persisted receipt and uncertain-write hold."""
import json,sqlite3,time
from pickup_core import PROTOCOL,canonical,digest,require,epoch
RECEIPT='ojala_counter_pickups_receipt_v1'

def check_capabilities(c):
 require(isinstance(c,dict) and c.get('protocol')==PROTOCOL and c.get('receiptProtocol')==RECEIPT,'pickup_contract_not_published')
 for k,v in {'credentialScoped':True,'browserRequired':False,'externalAiRequired':False,'requiresPersistedLocalObservation':True,'persistedReadbackRequired':True,'createsSales':False,'createsReviewedPhysicalCounts':False}.items():require(c.get(k) is v,'pickup_capability_scope')

def check_receipt(r,envelope,config):
 require(isinstance(r,dict) and r.get('protocol')==RECEIPT,'pickup_receipt_protocol')
 for k,v in {'persisted':True,'partial':True,'countsAreSales':False,'physicalUniqueCountCertified':False,'externalAiInvoked':False,'requiredHumanAction':False}.items():require(r.get(k) is v,'pickup_receipt_scope')
 doc=json.loads(envelope['documentJson'])
 for k,v in {'storeId':config['storeId'],'deviceId':config['deviceId'],'businessDate':doc['businessDate'],'cameraName':'handoff','sequence':envelope['sequence'],'documentSha256':envelope['documentSha256'],'recordsPersisted':len(doc['records'])}.items():
  require(r.get(k)==v and (type(r.get(k)) is int if type(v) is int else isinstance(r.get(k),str)),'pickup_receipt_identity_'+k)
 require(epoch(r['receivedAt'])<=time.time()+120,'pickup_receipt_future')
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
  day=document['businessDate'];text=canonical(document);sha=digest(text);require(len(text.encode())<=4*1024*1024,'pickup_document_limit')
  row=self.db.execute('SELECT * FROM outbox WHERE day=?',(day,)).fetchone()
  if row and row['status']=='blocked':return {'status':'blocked','reason':row['last_error'],'networkAttempted':False}
  if row and row['status']=='acknowledged' and row['document_sha']==sha:return {'status':'acknowledged','sequence':row['sequence'],'networkAttempted':False}
  if not row or row['status']=='acknowledged':
   seq=1 if row is None else row['sequence']+1
   with self.db:self.db.execute("INSERT INTO outbox(day,sequence,document_json,document_sha,status) VALUES(?,?,?,?,'pending') ON CONFLICT(day) DO UPDATE SET sequence=excluded.sequence,document_json=excluded.document_json,document_sha=excluded.document_sha,status='pending',attempts=0,dispatched=NULL,checks=0,last_error=NULL,receipt=NULL",(day,seq,text,sha))
   row=self.db.execute('SELECT * FROM outbox WHERE day=?',(day,)).fetchone()
  envelope={'sequence':row['sequence'],'documentJson':row['document_json'],'documentSha256':row['document_sha']}
  try:
   check_capabilities(self.transport.capabilities());require(row['status']=='delivery_unknown' or row['attempts']==0,'pending_after_dispatch')
   receipt=self.transport.receipt(self.config['deviceId'],day) if row['status']=='delivery_unknown' else None
   if receipt is not None:
    if receipt.get('sequence')==row['sequence']:
     self.accept(day,envelope,receipt);return {'status':'acknowledged','sequence':row['sequence'],'uploaded':False,'networkAttempted':True}
    require(receipt.get('storeId')==self.config['storeId'] and receipt.get('deviceId')==self.config['deviceId'] and receipt.get('businessDate')==day and type(receipt.get('sequence')) is int,'pickup_prior_receipt_scope')
    require(receipt['sequence']<row['sequence'],'pickup_future_revision_conflict')
   if row['status']=='delivery_unknown':
    checks=row['checks']+1;expired=row['dispatched'] is not None and time.time()-row['dispatched']>120 and checks>=6;state='blocked' if expired else 'delivery_unknown'
    with self.db:self.db.execute('UPDATE outbox SET status=?,checks=?,last_error=? WHERE day=?',(state,checks,'settled_without_matching_receipt' if expired else 'awaiting_matching_readback',day))
    return {'status':state,'uploaded':False,'networkAttempted':True}
   with self.db:self.db.execute("UPDATE outbox SET status='delivery_unknown',attempts=attempts+1,dispatched=?,checks=0 WHERE day=?",(time.time(),day))
   answer=self.transport.send(envelope);require(answer.get('success') is True,'pickup_write_not_acknowledged');self.accept(day,envelope,answer.get('receipt'))
   return {'status':'acknowledged','sequence':row['sequence'],'uploaded':True,'networkAttempted':True}
  except (ValueError,OSError,KeyError,TypeError) as exc:
   reason=str(exc)
   if len(reason)>100 or any(x in reason.lower() for x in ['://','password','token','apikey','api_key']):reason=type(exc).__name__
   current=self.db.execute('SELECT status FROM outbox WHERE day=?',(day,)).fetchone()[0]
   uncertain=current=='delivery_unknown' and reason in ('http_409','http_429','http_500','http_502','http_503','http_504','network_or_response_uncertain','pickup_write_not_acknowledged')
   transient=current=='pending' and reason in ('http_429','http_500','http_502','http_503','http_504','network_or_response_uncertain')
   status='delivery_unknown' if uncertain else 'pending' if transient or reason=='pickup_contract_not_published' else 'blocked'
   with self.db:self.db.execute('UPDATE outbox SET status=?,last_error=? WHERE day=?',(status,reason,day))
   return {'status':status,'reason':reason,'networkAttempted':True,'uploaded':False}
