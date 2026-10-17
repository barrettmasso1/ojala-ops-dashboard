import copy
from datetime import datetime,timezone
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import manus_bridge as b
import receipt_collector as r


def iso(t):return datetime.fromtimestamp(t,timezone.utc).isoformat()


class Api:
    def __init__(self,messages):self.messages=messages;self.calls=[];self.private=True
    def call(self,method,params=None,post=False):
        self.calls.append(method)
        assert not post
        if method=='task.detail':
            return {'task':{'id':b.TASK,'share_visibility':'private' if self.private else 'public'}}
        assert method=='task.listMessages'
        return {'messages':self.messages,'has_more':False}


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.now=time.time();self.sent=self.now-120
        self.manifest={'schemaVersion':1,'storeId':1,'cameraName':'handoff',
                       'businessDate':'2026-10-17','events':[{'cupEventId':'cup-original'}],
                       'countRecordIncluded':False,'countRecord':None}
        self.staged=b.stage(self.manifest,{},self.root);self.db=b.queue_db(self.root)
        b.update(self.db,self.staged['batchId'],status='awaiting_dashboard_receipt',sent_at=self.sent)
        self.row=self.db.execute('SELECT * FROM batches').fetchone()
        self.receipt={'batchId':self.row['id'],'packageSha256':self.row['sha256'],
                      'storeId':1,'businessDate':'2026-10-17','automaticPushVerified':False,
                      'readBackAt':iso(self.now-5),'countRow':None,
                      'visualRows':[{'id':360001,'cupEventId':'cup-original',
                                     'source':'verified_snapshot','status':'pending_review'}]}
    def tearDown(self):self.db.close();self.tmp.cleanup()
    def messages(self,receipt=None):
        return [{'id':'assistant-result','timestamp':str(int(self.now*1000)),
                 'type':'assistant_message','assistant_message':{'attachments':[
                     {'filename':'receipt.json','file_uid':'f1','version_uid':'v1',
                      'path':'/home/ubuntu/receipt.json','url':'not-used-by-fixture'}]}}]
    def validate(self,receipt=None,manifest=None):
        return r.validate_receipt(receipt or self.receipt,self.row,manifest or self.manifest,now=self.now)

    def test_valid_visual_receipt_has_no_inferred_count(self):
        result=self.validate();self.assertEqual(result['visualRows'],1)
        self.assertIsNone(result['cupsDetected']);self.assertFalse(result['directFrigateVerified'])

    def test_legacy_rows_supported_but_conflicting_dual_rows_rejected(self):
        x=copy.deepcopy(self.receipt);x['rows']=x.pop('visualRows');self.validate(x)
        x['visualRows']=[]
        with self.assertRaises(b.BridgeError):self.validate(x)

    def test_scope_hash_and_direct_claim_rejected(self):
        for key,value in [('batchId','b'*64),('packageSha256','c'*64),('storeId',2),
                          ('businessDate','2026-10-16'),('automaticPushVerified',True),('storeId',True)]:
            x=copy.deepcopy(self.receipt);x[key]=value
            with self.subTest(key=key,value=value),self.assertRaises(b.BridgeError):self.validate(x)

    def test_unrequested_count_is_not_an_ack(self):
        x=copy.deepcopy(self.receipt);x['countRow']={'id':1,'cupsDetected':1}
        with self.assertRaises(b.BridgeError):self.validate(x)
        del x['countRow']
        with self.assertRaises(b.BridgeError):self.validate(x)

    def test_missing_duplicate_foreign_events_and_bad_states_rejected(self):
        for rows in [[],self.receipt['visualRows']*2,
                     [dict(self.receipt['visualRows'][0],cupEventId='other')],
                     [dict(self.receipt['visualRows'][0],source='recording_extracted_frame')],
                     [dict(self.receipt['visualRows'][0],status='uploaded')],
                     [dict(self.receipt['visualRows'][0],cameraName='other')],
                     [dict(self.receipt['visualRows'][0],id=True)]]:
            x=copy.deepcopy(self.receipt);x['visualRows']=rows
            with self.assertRaises(b.BridgeError):self.validate(x)

    def test_readback_must_be_dated_after_dispatch_and_not_future(self):
        for at in ['2026-10-17T13:00:00',iso(self.sent-10),iso(self.now+300),None]:
            x=copy.deepcopy(self.receipt);x['readBackAt']=at
            with self.assertRaises(b.BridgeError):self.validate(x)

    def count_fixture(self):
        manifest=copy.deepcopy(self.manifest)
        record={'approvedAt':iso(self.sent-1000),'cupsDetected':2,'coverage':'partial','reviewedBy':'REAL REVIEWER'}
        manifest.update(countRecordIncluded=True,_originalCount=record,
                        countRecord={'recordSha256':'d'*64,'sourceEventId':'daily-reviewed-example'})
        x=copy.deepcopy(self.receipt)
        x['countRow']={'id':180001,'storeId':1,'businessDate':self.row['day'],'cameraName':'handoff',
                       'cupsDetected':2,'coverage':'partial','recordSha256':'d'*64,
                       'sourceEventId':'daily-reviewed-example','sourceEventAt':record['approvedAt'],
                       'receivedAt':iso(self.sent-500)}
        return manifest,x

    def test_existing_deduplicated_count_may_predate_new_upload(self):
        manifest,x=self.count_fixture()
        self.assertEqual(self.validate(x,manifest)['cupsDetected'],2)

    def test_count_cannot_change_amount_coverage_identity_or_reviewer(self):
        manifest,original=self.count_fixture()
        for key,value in [('cupsDetected',3),('coverage','complete'),('storeId',2),
                          ('sourceEventId','different'),('recordSha256','e'*64),
                          ('sourceEventAt',iso(self.sent)),('receivedAt',iso(self.now+100)),
                          ('reviewedBy','made-up')]:
            x=copy.deepcopy(original);x['countRow'][key]=value
            with self.subTest(key=key),self.assertRaises(b.BridgeError):self.validate(x,manifest)
        x=copy.deepcopy(original);x['countRow']=None
        with self.assertRaises(b.BridgeError):self.validate(x,manifest)

    def test_success_is_durable_and_not_downloaded_again(self):
        api=Api(self.messages());calls=[]
        def download(a):calls.append(a);return json.dumps(self.receipt).encode()
        result=r.collect_receipts(self.db,api,self.root,downloader=download)
        self.assertEqual(result['verified'],1)
        self.assertEqual(self.db.execute('SELECT status FROM batches').fetchone()[0],'admin_receipt_verified')
        proof=json.loads((self.root/'receipts'/self.row['id']/'automatic-verification.json').read_text())
        self.assertTrue(proof['automaticallyCollected']);self.assertNotIn('url',proof)
        self.assertEqual(r.collect_receipts(self.db,api,self.root,downloader=download)['verified'],0)
        self.assertEqual(len(calls),1)
        self.assertNotIn('task.sendMessage',api.calls)

    def test_bad_receipt_keeps_original_queue_pending(self):
        x=copy.deepcopy(self.receipt);x['visualRows']=[]
        result=r.collect_receipts(self.db,Api(self.messages()),self.root,downloader=lambda a:json.dumps(x).encode())
        self.assertEqual(result['verified'],0)
        self.assertEqual(self.db.execute('SELECT status FROM batches').fetchone()[0],'awaiting_dashboard_receipt')

    def test_changed_package_never_acknowledged(self):
        Path(self.row['path']).write_bytes(b'changed')
        result=r.collect_receipts(self.db,Api(self.messages()),self.root,downloader=lambda a:json.dumps(self.receipt).encode())
        self.assertEqual(result['verified'],0)

    def test_download_failure_does_not_ack_or_resend(self):
        def broken(a):raise b.BridgeError('receipt_download_http_403')
        api=Api(self.messages());result=r.collect_receipts(self.db,api,self.root,downloader=broken)
        self.assertEqual(result['verified'],0);self.assertNotIn('task.sendMessage',api.calls)

    def test_user_attachments_and_old_assistant_messages_are_ignored(self):
        messages=self.messages();messages[0]['type']='user_message'
        self.assertEqual(list(r.receipt_messages(Api(messages),self.sent)),[])
        messages=self.messages();messages[0]['timestamp']=str(int((self.sent-10)*1000))
        self.assertEqual(list(r.receipt_messages(Api(messages),self.sent)),[])

    def test_private_task_required_and_auth_hold_avoids_api(self):
        api=Api(self.messages());api.private=False
        with self.assertRaises(b.BridgeError):r.collect_receipts(self.db,api,self.root)
        api.calls=[];self.db.execute("INSERT INTO controls VALUES('api_auth_hold','403')");self.db.commit()
        self.assertEqual(r.collect_receipts(self.db,api,self.root)['status'],'api_auth_hold')
        self.assertEqual(api.calls,[])

    def test_download_rejects_external_hosts_http_and_credentials(self):
        for url in ['http://private.manuscdn.com/a','https://private.manuscdn.com.evil.test/a',
                    'https://user:pass@private.manuscdn.com/a','https://localhost/a',
                    'https://private.manuscdn.com:444/a']:
            with self.assertRaises(b.BridgeError):r.download_attachment({'url':url})

    def test_download_uses_no_key_no_redirect_and_size_limit(self):
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*a):return False
            def read(self,n):return b'{}'
        with patch.object(r.urllib.request,'build_opener') as factory:
            factory.return_value.open.return_value=Response()
            self.assertEqual(r.download_attachment({'url':'https://private-us-east-1.manuscdn.com/a'}),b'{}')
            req=factory.return_value.open.call_args.args[0]
            self.assertNotIn('X-manus-api-key',dict(req.header_items()))
            self.assertIsInstance(factory.call_args.args[0],b.NoRedirect)


if __name__=='__main__':unittest.main()
