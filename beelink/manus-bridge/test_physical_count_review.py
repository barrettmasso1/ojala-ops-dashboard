import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile
import manus_bridge as b
import physical_count_review as p

class PhysicalReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name);self.state=self.base/'manus-bridge/state'
        self.state.mkdir(parents=True)
        for rel,src in [('count-review/review_counts.py','../count-review/review_counts.py'),
                        ('scripts/frigate_push_counts.py','../count-push/frigate_push_counts.py')]:
            dest=self.base/rel;dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(Path(__file__).parent/src,dest)
        self.day=(datetime.now(b.TZ).date()-timedelta(days=1)).isoformat()
        stamp=datetime.fromisoformat(self.day+'T14:00:00-07:00').timestamp()
        self.segment='segments/recordings/'+self.day+'/21/handoff/00.00.mp4'
        content=b'validator-test-bytes-not-real-video'
        self.files={self.segment:content}
        self.manifest={'schemaVersion':1,'businessDate':self.day,'storeId':1,'cameraName':'handoff',
            'countRecordIncluded':False,'events':[{'cupEventId':'event-a','segments':[
                {'path':self.segment,'startTime':stamp,'endTime':stamp+9.9}]}],
            'files':[{'path':self.segment,'bytes':len(content),'sha256':b.digest(content)}]}
        staged=b.stage(self.manifest,self.files,self.state);self.db=b.queue_db(self.state)
        self.addCleanup(self.db.close)
        self.row=self.db.execute('SELECT * FROM batches WHERE id=?',(staged['batchId'],)).fetchone()
        self.job={'id':p.job_id(self.row['id'],False),'day':self.day,'batchId':self.row['id'],
            'packageSha256':self.row['sha256'],'sentAt':time.time()-30,'replay':False}
        at=lambda secs:datetime.fromtimestamp(stamp+secs,timezone.utc).isoformat()
        self.doc={'schemaVersion':1,'policy':p.POLICY,'jobId':self.job['id'],'batchId':self.row['id'],
            'packageSha256':self.row['sha256'],'reviewerType':'ai','humanApproved':False,
            'reviewedAt':datetime.now(timezone.utc).isoformat(),'status':'reviewed','ledger':{
                'businessDate':self.day,'storeId':1,'cameraName':'handoff',
                'countBasis':'reviewed_unique_physical_cups','reviewedBy':p.AI_REVIEWER,
                'status':'approved','coverage':'partial','candidateIds':['event-a'],
                'evidence':[{'id':'before','path':self.segment,'sha256':b.digest(content),'at':at(1)},
                            {'id':'after','path':self.segment,'sha256':b.digest(content),'at':at(8)}],
                'units':[{'id':'physical-a','decision':'confirmed','personAndFilledCup':True,
                    'inHandoffZone':True,'evidenceIds':['before','after'],
                    'identityReason':'Synthetic validator fixture; not visual accuracy evidence.'}],
                'cases':[{'id':'scene-a','candidateIds':['event-a'],'disposition':'counted',
                    'unitIds':['physical-a'],'evidenceIds':['before','after']}],
                'dailyReview':{'scope':'confirmed_units_in_partial_evidence','completed':True,
                    'gaps':['Only a test window, not a full operating day.']}}}

    def normalize(self,document=None):
        return p.normalize_review(document or self.doc,self.job,self.row,self.base)

    def test_valid_partial_and_existing_bridge_ledger_contract(self):
        record,folder,result=self.normalize()
        self.assertEqual(record['cupsDetected'],1)
        self.assertIsNone(record['dailyCupCount'])
        self.assertEqual(record['coverage'],'partial')
        target=self.base/'scripts/approved_counts'/(self.day+'.json')
        p.save_new(target,json.dumps(record,sort_keys=True).encode())
        files={};attached=b.attach_reviewed_count(self.day,self.base,files)
        self.assertEqual(attached['cupsDetected'],1)
        self.assertEqual(attached['ledgerSha256'],record['ledgerSha256'])
        self.assertFalse((self.state/'physical-reviews').exists())
        self.assertEqual(len([x for x in files if x.endswith('.mp4')]),1)

    def test_binding_tamper_is_rejected(self):
        for field in ['jobId','batchId','packageSha256']:
            d=copy.deepcopy(self.doc);d[field]='bad'
            with self.subTest(field=field),self.assertRaises(b.BridgeError):self.normalize(d)

    def test_photos_cannot_be_temporal_video_evidence(self):
        d=copy.deepcopy(self.doc);d['ledger']['evidence'][0]['path']='snapshots/cup.jpg'
        with self.assertRaisesRegex(b.BridgeError,'original_handoff_video_required'):self.normalize(d)

    def test_frame_outside_original_video_is_rejected(self):
        d=copy.deepcopy(self.doc)
        frame=datetime.fromisoformat(d['ledger']['evidence'][0]['at'])+timedelta(hours=1)
        d['ledger']['evidence'][0]['at']=frame.isoformat()
        with self.assertRaisesRegex(b.BridgeError,'outside_original_segment'):self.normalize(d)

    def test_duplicate_frame_time_does_not_establish_temporal_identity(self):
        d=copy.deepcopy(self.doc);d['ledger']['evidence'][1]['at']=d['ledger']['evidence'][0]['at']
        with self.assertRaisesRegex(ValueError,'temporal_evidence_missing'):self.normalize(d)

    def test_cannot_claim_complete_day_or_human_review(self):
        for changed in ['complete','human']:
            d=copy.deepcopy(self.doc)
            if changed=='complete':d['ledger']['coverage']='complete'
            else:d['humanApproved']=True
            with self.subTest(changed=changed),self.assertRaises(b.BridgeError):self.normalize(d)

    def test_candidates_cannot_be_omitted_or_double_counted(self):
        for changed in ['omitted','duplicated']:
            d=copy.deepcopy(self.doc)
            if changed=='omitted':d['ledger']['candidateIds']=[]
            else:d['ledger']['cases'].append(copy.deepcopy(d['ledger']['cases'][0]))
            with self.subTest(changed=changed),self.assertRaises((ValueError,b.BridgeError)):
                self.normalize(d)

    def test_pending_unit_is_excluded_even_if_other_case_counts_it(self):
        d=copy.deepcopy(self.doc)
        d['ledger']['cases'][0]['disposition']='pending'
        with self.assertRaisesRegex(ValueError,'no_confirmed_partial_units'):self.normalize(d)

    def test_no_supported_units_does_not_publish_zero(self):
        d=copy.deepcopy(self.doc);d['status']='no_supported_units'
        d['ledger']['units']=[]
        d['ledger']['cases'][0].update(disposition='pending',unitIds=[])
        record,folder,result=self.normalize(d)
        self.assertIsNone(record)
        self.assertFalse((self.base/'scripts/approved_counts'/ (self.day+'.json')).exists())

    def test_publish_preserves_existing_count(self):
        record,_,_=self.normalize()
        target=self.base/'scripts/approved_counts'/(self.day+'.json')
        p.save_new(target,b'{"existing":true}')
        with self.assertRaisesRegex(b.BridgeError,'existing_count_preserved'):
            p.publish_record(record,self.job,self.base)
        self.assertEqual(target.read_bytes(),b'{"existing":true}')

    def test_repeated_normalization_is_idempotent(self):
        record,folder,_=self.normalize()
        record2,folder2,_=self.normalize()
        self.assertEqual(record,record2);self.assertEqual(folder,folder2)

    def test_archive_modified_after_queue_is_rejected(self):
        with Path(self.row['path']).open('ab') as f:f.write(b'modified')
        with self.assertRaisesRegex(b.BridgeError,'package_hash_mismatch'):self.normalize()

    def test_path_traversal_is_rejected(self):
        d=copy.deepcopy(self.doc);d['ledger']['evidence'][0]['path']='../../secret'
        with self.assertRaises(b.BridgeError):self.normalize(d)

    def test_dispatch_uncertainty_is_not_resent(self):
        self.db.execute('UPDATE batches SET sent_at=?,file_id=? WHERE id=?',
                        (time.time(),'already-uploaded',self.row['id']));self.db.commit()
        class API:
            sends=0
            def call(inner,method,args,post=False):
                if method=='task.detail':return {'task':{'id':b.TASK,'share_visibility':'private','status':'stopped'}}
                if method=='file.detail':return {'file':{'id':'already-uploaded','status':'uploaded',
                    'bytes':Path(self.row['path']).stat().st_size}}
                inner.sends+=1;raise b.BridgeError('api_network_or_response_error')
        api=API()
        one=p.dispatch(self.db,api,self.base,self.day)
        two=p.dispatch(self.db,api,self.base,self.day)
        self.assertEqual(one['status'],'dispatching');self.assertEqual(two['status'],'dispatching')
        self.assertEqual(api.sends,1)

    def test_validated_job_recovers_without_network_or_second_review(self):
        record,folder,_=self.normalize()
        jobs=self.state/'physical-reviews';path=jobs/self.job['id']/'state.json'
        job=dict(self.job,status='validated',cupCount=1,ledgerDirectory=str(folder))
        b.private_json(path,job)
        with patch.object(p,'publish_record',return_value={'batchId':self.row['id']}) as publish:
            result=p.receive_jobs(self.db,None,self.base,jobs)
        self.assertEqual(publish.call_count,1)
        self.assertTrue(result[0]['recoveredAfterInterruption'])
        self.assertEqual(json.loads(path.read_text())['status'],'count_queued')
        self.assertFalse(json.loads(path.read_text())['dashboardReceived'])

    def test_receipt_is_required_to_mark_dashboard_received(self):
        jobs=self.state/'physical-reviews';path=jobs/self.job['id']/'state.json'
        job=dict(self.job,status='count_queued',cupCount=1,countBatchId=self.row['id'],dashboardReceived=False)
        b.private_json(path,job)
        p.receive_jobs(self.db,None,self.base,jobs)
        self.assertFalse(json.loads(path.read_text())['dashboardReceived'])
        self.db.execute('UPDATE batches SET status=? WHERE id=?',('admin_receipt_verified',self.row['id']))
        self.db.commit()
        p.receive_jobs(self.db,None,self.base,jobs)
        saved=json.loads(path.read_text())
        self.assertEqual(saved['status'],'count_receipt_verified')
        self.assertTrue(saved['dashboardReceived']);self.assertFalse(saved['directFrigateVerified'])

    def test_known_production_count_is_preserved_without_api_call(self):
        dest=self.state/'physical-reviews/existing-production'/(self.day+'.json')
        b.private_json(dest,{'verifiedReceipt':'retained'})
        result=p.dispatch(self.db,None,self.base,self.day)
        self.assertEqual(result['status'],'existing_production_count_preserved')

    def test_review_only_replay_does_not_publish(self):
        jobs=self.state/'physical-reviews';path=jobs/self.job['id']/'state.json'
        job=dict(self.job,status='awaiting_review',replay=True)
        b.private_json(path,job)
        document=self.doc
        class API:
            def call(inner,method,args):
                if method=='task.detail':return {'task':{'id':b.TASK,'share_visibility':'private'}}
                return {'messages':[{'timestamp':str(time.time()*1000),'type':'assistant_message',
                    'assistant_message':{'attachments':[{'filename':'physical-review-'+job['id']+'.json'}]}}]}
        with patch.object(p,'download_attachment',return_value=json.dumps(document).encode()), \
             patch.object(p,'publish_record') as publish:
            p.receive_jobs(self.db,API(),self.base,jobs)
        publish.assert_not_called()
        self.assertEqual(json.loads(path.read_text())['status'],'replay_validated')
        self.assertFalse((self.base/'scripts/approved_counts'/(self.day+'.json')).exists())

    def test_reviewer_cannot_claim_an_operator_approval(self):
        d=copy.deepcopy(self.doc)
        d['ledger']['reviewedBy']='Manus AI — approved by an operator'
        with self.assertRaisesRegex(b.BridgeError,'reviewer_attribution_missing'):self.normalize(d)

    def test_candidate_needs_its_own_source_video_reference(self):
        d=copy.deepcopy(self.doc);d['ledger']['cases'][0]['evidenceIds']=['invented-reference']
        with self.assertRaisesRegex(b.BridgeError,'candidate_video_reference_missing'):self.normalize(d)

if __name__=='__main__':unittest.main()
