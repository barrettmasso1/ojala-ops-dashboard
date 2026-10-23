import copy,json,sqlite3,tempfile,unittest
from pathlib import Path
from ledger import *
from collector import read_tracks
MODEL='a'*64
START=datetime(2026,10,22,23,0,tzinfo=timezone.utc).timestamp()
IMAGE=b'\xff\xd8\xffLOCAL_UNIT_TEST_ONLY'

def track(i=1,start=START,end=None,rect=None):
    return normalize_track({'id':f'1792710000.123456-cup{i:03d}','label':'cup','camera':'handoff','start_time':start,'end_time':end,'false_positive':False,'zones':['handoff_zone'],'data':{'top_score':0.8,'box':rect or [.4,.5,.08,.1]}},'device-test',MODEL)

def meta(t=None):
    t=t or track();geom={'name':'handoff_zone','coordinate_system':'normalized','polygon':[[.2,.2],[.8,.2],[.8,.9],[.2,.9]],'reference_width':2304,'reference_height':1296,'membership_rule':'box_bottom_center'}
    return {'schema_version':3,'gate_version':'unit-test','camera':'handoff','cup_zone':'handoff_zone','cup_event_id':t['sourceEventId'],'captured_at_utc':timestamp(parse_aware(t['startedAt']).timestamp()+1),'image_sha256':digest(IMAGE),'zone_geometry':geom,'zone_config_sha256':digest(canonical(geom)),'image_dimensions':{'width':2304,'height':1296},'cup':{'score':.8,'box':[.4,.5,.08,.1]},'people':[{'score':.8,'box':[.1,.1,.3,.5]}]}

class IdentityTests(unittest.TestCase):
    def test_ended_track_is_accepted(self):self.assertIsNotNone(track(end=START+.2)['endedAt'])
    def test_utc_is_mazatlan_previous_day(self):self.assertEqual(track(start=datetime(2026,10,23,2,tzinfo=timezone.utc).timestamp())['businessDate'],'2026-10-22')
    def test_stable_identifier(self):self.assertEqual(track()['observationId'],track()['observationId'])
    def test_distinct_tracks_have_distinct_identifiers(self):self.assertNotEqual(track(1)['observationId'],track(2)['observationId'])
    def test_future_timezone_not_assumed(self):
        with self.assertRaisesRegex(InvalidEvidence,'timestamp_missing_zone'):parse_aware('2026-10-22T14:00:00')
    def test_model_fingerprint_required(self):
        with self.assertRaisesRegex(InvalidEvidence,'invalid_model'):normalize_track({},'device','not-a-sha')
    def test_wrong_source_rejected(self):
        with self.assertRaisesRegex(InvalidEvidence,'wrong_source'):normalize_track({'camera':'other','label':'cup'},'dev',MODEL)
    def test_invalid_box_nan(self):
        with self.assertRaisesRegex(InvalidEvidence,'invalid_box'):track(rect=[.1,.1,float('nan'),.1])
    def test_negative_box_width(self):
        with self.assertRaisesRegex(InvalidEvidence,'box_outside_image'):track(rect=[.1,.1,-.1,.1])
    def test_box_exceeds_image(self):
        with self.assertRaisesRegex(InvalidEvidence,'box_outside_image'):track(rect=[.9,.1,.4,.1])
    def test_end_before_start(self):
        with self.assertRaisesRegex(InvalidEvidence,'invalid_end_time'):track(end=START-1)
    def test_no_size_guess(self):self.assertEqual(track()['size'],'unknown')
    def test_detection_is_not_delivery(self):self.assertFalse(track()['physicalDeliveryConfirmed'])
    def test_finite_timestamp_only(self):
        with self.assertRaises(InvalidEvidence):track(start=True)

class EvidenceTests(unittest.TestCase):
    def test_genuine_local_fields_accepted(self):self.assertEqual(verify_sidecar(meta(),IMAGE,track())['personDetections'],1)
    def test_wrong_image_hash(self):
        with self.assertRaisesRegex(InvalidEvidence,'image_hash'):verify_sidecar(meta(),IMAGE+b'changed',track())
    def test_wrong_event(self):
        with self.assertRaisesRegex(InvalidEvidence,'event_identity'):verify_sidecar(meta(track(2)),IMAGE,track())
    def test_missing_person(self):
        m=meta();m['people']=[]
        with self.assertRaisesRegex(InvalidEvidence,'missing_local_person'):verify_sidecar(m,IMAGE,track())
    def test_bad_person_box(self):
        m=meta();m['people'][0]['box']=[.5,.5,.4,.4]
        with self.assertRaisesRegex(InvalidEvidence,'invalid_person_box'):verify_sidecar(m,IMAGE,track())
    def test_weak_local_cup_rejected(self):
        m=meta();m['cup']['score']=.3
        with self.assertRaisesRegex(InvalidEvidence,'invalid_local_cup'):verify_sidecar(m,IMAGE,track())
    def test_weak_person_rejected(self):
        m=meta();m['people'][0]['score']=.3
        with self.assertRaisesRegex(InvalidEvidence,'invalid_person_score'):verify_sidecar(m,IMAGE,track())
    def test_geometry_hash_must_match(self):
        m=meta();m['zone_config_sha256']='b'*64
        with self.assertRaisesRegex(InvalidEvidence,'geometry_hash'):verify_sidecar(m,IMAGE,track())
    def test_outside_zone_rejected(self):
        m=meta();m['cup']['box']=[.01,.01,.05,.05]
        with self.assertRaisesRegex(InvalidEvidence,'outside_zone'):verify_sidecar(m,IMAGE,track())
    def test_polygon_edge_is_inside(self):self.assertTrue(inside((.8,.6),meta()['zone_geometry']['polygon']))
    def test_bad_dimensions_rejected(self):
        m=meta();m['image_dimensions']['width']=True
        with self.assertRaisesRegex(InvalidEvidence,'invalid_dimensions'):verify_sidecar(m,IMAGE,track())
    def test_non_jpeg_rejected(self):
        with self.assertRaisesRegex(InvalidEvidence,'invalid_jpeg'):verify_sidecar(meta(),b'not a jpeg',track())
    def test_missing_timezone_rejected(self):
        m=meta();m['captured_at_utc']='2026-10-22T23:00:01'
        with self.assertRaisesRegex(InvalidEvidence,'timestamp_missing_zone'):verify_sidecar(m,IMAGE,track())
    def test_capture_before_event_rejected(self):
        m=meta();m['captured_at_utc']=timestamp(START-10)
        with self.assertRaisesRegex(InvalidEvidence,'outside_event_window'):verify_sidecar(m,IMAGE,track())
    def test_capture_late_after_end_rejected(self):
        m=meta();m['captured_at_utc']=timestamp(START+20)
        with self.assertRaisesRegex(InvalidEvidence,'capture_after_event_end'):verify_sidecar(m,IMAGE,track(end=START+2))
    def test_false_positive_not_verified(self):
        t=track();t['sourceFalsePositive']=True
        with self.assertRaisesRegex(InvalidEvidence,'source_marked_false_positive'):verify_sidecar(meta(),IMAGE,t)
    def test_validation_does_not_mutate_sources(self):
        m=meta();t=track();before=canonical([m,t]);verify_sidecar(m,IMAGE,t);self.assertEqual(canonical([m,t]),before)
    def test_legacy_schema_not_promoted(self):
        m=meta();m['schema_version']=2
        with self.assertRaisesRegex(InvalidEvidence,'unsupported_sidecar'):verify_sidecar(m,IMAGE,track())

class LedgerTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'ledger.sqlite3';self.ledger=Ledger(self.path)
    def tearDown(self):self.ledger.close();self.tmp.cleanup()
    def test_repeated_poll_one_record(self):
        for _ in range(100):self.ledger.put(track())
        self.assertEqual(self.ledger.snapshot('2026-10-22')['detectorTracksRecorded'],1)
        self.assertEqual(self.ledger.db.execute('SELECT revision FROM observations').fetchone()[0],1)
    def test_three_simultaneous_cups_kept(self):
        for n in (1,2,3):self.ledger.put(track(n))
        snap=self.ledger.snapshot('2026-10-22');self.assertEqual(snap['detectorTracksRecorded'],3);self.assertEqual(snap['potentialRepeatObservations'],0)
    def test_restart_does_not_repeat(self):
        self.ledger.put(track());self.ledger.close();self.ledger=Ledger(self.path);self.assertFalse(self.ledger.put(track()))
    def test_late_sidecar_adds_verification_not_cup(self):
        self.ledger.put(track());self.ledger.put(track(),verify_sidecar(meta(),IMAGE,track()))
        snap=self.ledger.snapshot('2026-10-22');self.assertEqual(snap['detectorTracksRecorded'],1);self.assertEqual(snap['sameFrameVerifiedObservations'],1)
    def test_missing_sidecar_afterwards_keeps_evidence(self):
        self.ledger.put(track(),verify_sidecar(meta(),IMAGE,track()));self.ledger.put(track())
        self.assertEqual(self.ledger.snapshot('2026-10-22')['sameFrameVerifiedObservations'],1)
    def test_source_id_identity_conflict(self):
        self.ledger.put(track());t=track();t['startedAt']=timestamp(START+1)
        with self.assertRaisesRegex(InvalidEvidence,'immutable_identity'):self.ledger.put(t)
    def test_replacing_evidence_forbidden(self):
        proof=verify_sidecar(meta(),IMAGE,track());self.ledger.put(track(),proof);proof['imageSha256']='b'*64
        with self.assertRaisesRegex(InvalidEvidence,'evidence_replacement'):self.ledger.put(track(),proof)
    def test_end_time_update_single_observation(self):
        self.ledger.put(track());self.ledger.put(track(end=START+10));self.assertEqual(len(self.ledger.rows('2026-10-22')),1)
    def test_stale_open_does_not_erase_end(self):
        self.ledger.put(track(end=START+10));self.ledger.put(track());self.assertIsNotNone(self.ledger.rows('2026-10-22')[0]['endedAt'])
    def test_unknown_size_preserved(self):
        self.ledger.put(track(),verify_sidecar(meta(),IMAGE,track()));self.assertEqual(self.ledger.snapshot('2026-10-22')['sizeBreakdownOfVerifiedObservations']['unknown'],1)
    def test_no_automatic_daily_physical_count(self):
        self.ledger.put(track());self.assertIsNone(self.ledger.snapshot('2026-10-22')['uniquePhysicalDeliveries'])
    def test_false_positive_does_not_stay_verified(self):
        self.ledger.put(track(),verify_sidecar(meta(),IMAGE,track()));t=track();t['sourceFalsePositive']=True;self.ledger.put(t)
        self.assertEqual(self.ledger.snapshot('2026-10-22')['sameFrameVerifiedObservations'],0)
    def test_uncertain_duplicate_flag_not_silent_merge(self):
        self.ledger.put(track(1,end=START+4));self.ledger.put(track(2,start=START+6,end=START+9))
        s=self.ledger.snapshot('2026-10-22');self.assertEqual(s['potentialRepeatObservations'],1);self.assertEqual(s['detectorTracksRecorded'],2)
    def test_spatially_different_not_duplicate(self):
        self.assertFalse(possible_repeats([track(1,end=START+4),track(2,start=START+6,rect=[.7,.5,.05,.1])]))
    def test_long_gap_not_marked_same_cup(self):
        self.assertFalse(possible_repeats([track(1,end=START+4),track(2,start=START+60)]))
    def test_simultaneous_tracks_not_merged_by_time_or_position(self):
        self.assertFalse(possible_repeats([track(1,end=START+20),track(2,start=START+3,end=START+22)]))
    def receipt(self):
        r=self.ledger.db.execute('SELECT * FROM outbox').fetchone();return {'protocol':'ojala_local_cup_receipt_v1','observationId':r['id'],'revision':r['revision'],'payloadSha256':r['payload_sha'],'persisted':True,'externalAiInvoked':False,'physicalDeliveryCountCreated':False}
    def test_ack_matches_revision_and_hash(self):
        t=track();self.ledger.put(t);self.ledger.acknowledge(t['observationId'],self.receipt());self.assertEqual(self.ledger.snapshot('2026-10-22')['outboxStates'],{'acknowledged':1})
    def test_http_success_not_receipt(self):
        t=track();self.ledger.put(t)
        with self.assertRaisesRegex(InvalidEvidence,'receipt_protocol'):self.ledger.acknowledge(t['observationId'],{'success':True})
    def test_stale_ack_does_not_ack_new_version(self):
        t=track();self.ledger.put(t);old=self.receipt();self.ledger.put(track(end=START+10))
        with self.assertRaisesRegex(InvalidEvidence,'receipt_identity'):self.ledger.acknowledge(t['observationId'],old)
    def test_wrong_hash_ack_rejected(self):
        t=track();self.ledger.put(t);r=self.receipt();r['payloadSha256']='b'*64
        with self.assertRaisesRegex(InvalidEvidence,'receipt_identity'):self.ledger.acknowledge(t['observationId'],r)
    def test_boolean_revision_rejected(self):
        t=track();self.ledger.put(t);r=self.receipt();r['revision']=True
        with self.assertRaisesRegex(InvalidEvidence,'receipt_identity'):self.ledger.acknowledge(t['observationId'],r)
    def test_external_ia_receipt_rejected(self):
        t=track();self.ledger.put(t);r=self.receipt();r['externalAiInvoked']=True
        with self.assertRaisesRegex(InvalidEvidence,'receipt_scope'):self.ledger.acknowledge(t['observationId'],r)
    def test_interrupted_dispatch_retains_unknown(self):
        t=track();self.ledger.put(t);self.ledger.mark_dispatched(t['observationId']);self.ledger.close();self.ledger=Ledger(self.path)
        self.assertEqual(self.ledger.snapshot('2026-10-22')['outboxStates'],{'delivery_unknown':1})
    def test_audit_persists_only_real_changes(self):
        self.ledger.put(track());self.ledger.put(track());self.ledger.put(track(end=START+10));self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM audit').fetchone()[0],2)
    def test_no_other_date_mix(self):
        self.ledger.put(track());self.assertEqual(self.ledger.snapshot('2026-10-21')['detectorTracksRecorded'],0)

class SourceTests(unittest.TestCase):
    def test_read_only_source_collects_short_ended_track(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'source.sqlite3';db=sqlite3.connect(p)
            db.execute('CREATE TABLE event(id,label,camera,start_time,end_time,top_score,false_positive,zones,box,data,model_hash,detector_type)')
            db.execute('INSERT INTO event VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',('fixture123','cup','handoff',START,START+.1,.8,0,'["handoff_zone"]',None,'{"box":[0.4,0.5,0.08,0.1],"top_score":0.8}',None,'openvino'));db.commit();db.close()
            before=p.read_bytes();rows=read_tracks(p,'2026-10-22');self.assertEqual(len(rows),1);self.assertEqual(p.read_bytes(),before)
    def test_missing_source_never_creates_source_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'missing.sqlite3'
            with self.assertRaisesRegex(InvalidEvidence,'source_database_missing'):read_tracks(p,'2026-10-22')
            self.assertFalse(p.exists())
    def test_core_has_no_external_api_or_browser_imports(self):
        import ast,inspect,ledger,collector
        modules=set()
        for m in (ledger,collector):
            tree=ast.parse(inspect.getsource(m))
            for n in ast.walk(tree):
                if isinstance(n,ast.Import):modules.update(a.name for a in n.names)
                if isinstance(n,ast.ImportFrom):modules.add(n.module or '')
        self.assertFalse(any(x.startswith(('openai','anthropic','google.genai','selenium','playwright','urllib','requests')) for x in modules))

if __name__=='__main__':unittest.main()
