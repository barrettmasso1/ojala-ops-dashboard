import copy, sys, unittest
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from persisted_receipt import validate_persisted_receipt, ReceiptError, PROTOCOL

class PersistedReceiptTests(unittest.TestCase):
    def setUp(self):
        self.capture = {'camera':'handoff','cup_event_id':'fixture-event-001',
                        'captured_at_utc':'2026-10-18T22:10:00.123456+00:00','image_sha256':'a'*64}
        self.ack = {'success':True,'eventId':42,'status':'pending_review','retryable':False,
          'receipt':{'protocol':PROTOCOL,'evidencePersisted':True,'physicalCupCountCreated':False,
            'storeId':1,'eventId':42,'cameraName':'handoff','businessDate':'2026-10-18',
            'cupEventId':'fixture-event-001','capturedAt':self.capture['captured_at_utc'],
            'imageSha256':'a'*64,'receivedAt':'2026-10-18T22:10:02Z',
            'evidenceOrigin':'verified_snapshot','analysisStatus':'pending_review'}}
        self.now=datetime(2026,10,19,tzinfo=timezone.utc)
    def test_valid_pending_ai_receipt_finishes_only_transport(self):
        r=validate_persisted_receipt(self.ack,self.capture,now=self.now)
        self.assertTrue(r['evidencePersisted']);self.assertFalse(r['physicalCupCountCreated'])
    def test_cross_store_refused(self):
        self.ack['receipt']['storeId']=2
        with self.assertRaises(ReceiptError):validate_persisted_receipt(self.ack,self.capture,now=self.now)
    def test_wrong_hash_refused(self):
        self.ack['receipt']['imageSha256']='b'*64
        with self.assertRaises(ReceiptError):validate_persisted_receipt(self.ack,self.capture,now=self.now)
    def test_old_loose_ack_refused(self):
        del self.ack['receipt']
        with self.assertRaises(ReceiptError):validate_persisted_receipt(self.ack,self.capture,now=self.now)
    def test_mismatched_fields_refused(self):
        changes={'protocol':'other','cameraName':'other','businessDate':'2026-10-17','eventId':43,
                 'capturedAt':'2026-10-18T22:10:01Z','cupEventId':'other-event','evidenceOrigin':'recording_extracted_frame',
                 'evidencePersisted':False,'physicalCupCountCreated':True,'analysisStatus':'discarded',
                 'receivedAt':'2026-10-20T00:00:00Z'}
        for field,value in changes.items():
            with self.subTest(field=field):
                a=copy.deepcopy(self.ack);a['receipt'][field]=value
                with self.assertRaises(ReceiptError):validate_persisted_receipt(a,self.capture,now=self.now)
    def test_bool_is_not_a_row_id(self):
        self.ack['eventId']=True;self.ack['receipt']['eventId']=True
        with self.assertRaises(ReceiptError):validate_persisted_receipt(self.ack,self.capture,now=self.now)
    def test_timezone_required(self):
        self.ack['receipt']['receivedAt']='2026-10-18T22:10:02'
        with self.assertRaises(ReceiptError):validate_persisted_receipt(self.ack,self.capture,now=self.now)
    def test_unchanged_inputs(self):
        a=copy.deepcopy(self.ack);c=copy.deepcopy(self.capture)
        validate_persisted_receipt(a,c,now=self.now)
        self.assertEqual(a,self.ack);self.assertEqual(c,self.capture)

if __name__=='__main__':unittest.main()
