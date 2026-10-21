import hashlib,json,shutil,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
import manus_bridge as b
import realtime_visual_bridge as rt
import receipt_collector as rc
import physical_count_review as pc
import package_storage as ps
from test_manus_bridge import FakeApi

class IncrementalTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.base=Path(self.tmp.name)
  self.images=self.base/'config/verified_snapshots/handoff'; self.images.mkdir(parents=True)
  self.sender=types.SimpleNamespace(ALLOWED_SUFFIXES={'.jpg'},SenderError=type('SenderError',(Exception,),{}))
  self.sender.sidecar_path=lambda p:p.with_suffix('.json');self.sender.event_metadata=self.metadata
 def tearDown(self):self.tmp.cleanup()
 def metadata(self,p):return json.loads(p.with_suffix('.json').read_text()),hashlib.sha256(p.read_bytes()).hexdigest()
 def image(self,i):
  p=self.images/(str(i).zfill(3)+'.jpg');p.write_bytes(b'TEST_FIXTURE_'+str(i).encode())
  p.with_suffix('.json').write_text(json.dumps({'schema_version':3,'cup_event_id':str(i),'captured_at_utc':'2026-10-18T20:00:00+00:00','people':[{}],'cup':{'score':0.8}}));return p
 def collect(self,**kw):
  with patch.object(b,'load_module',return_value=self.sender),patch.object(b.time,'time',return_value=9999999999):return b.assemble('2026-10-18',self.base,**kw)
 def test_visual_never_reads_count(self):
  self.image(1)
  with patch.object(b,'attach_reviewed_count',side_effect=AssertionError()):m,f=self.collect(include_count=False,max_events=5)
  self.assertIsNone(m['cupsDetected']);self.assertFalse(m['countRecordIncluded'])
 def test_limit_before_packaging(self):
  for i in range(30):self.image(i)
  m,f=self.collect(include_count=False,max_events=5);self.assertEqual(len(m['events']),5);self.assertEqual(len(f),10)
 def test_covered_excluded_before_selection(self):
  for i in range(8):self.image(i)
  m,f=self.collect(include_count=False,exclude_event_ids={'0','1','2','3','4'},max_events=2)
  self.assertEqual([e['cupEventId'] for e in m['events']],['5','6'])
 def test_empty_does_not_create_zero(self):
  self.image(1)
  with self.assertRaisesRegex(b.BridgeError,'no_verified_evidence_for_date'):self.collect(include_count=False,exclude_event_ids={'1'},max_events=5)
 def test_nightly_keeps_count_validation(self):
  self.image(1)
  with patch.object(b,'attach_reviewed_count',return_value=None) as count:self.collect()
  count.assert_called_once()
 def test_invalid_limit(self):
  with self.assertRaisesRegex(b.BridgeError,'invalid_event_limit'):self.collect(max_events=0)
 def test_failed_event_leaves_no_orphan(self):
  p=self.image(0);x=json.loads(p.with_suffix('.json').read_text());x['cup_event_start']=0;p.with_suffix('.json').write_text(json.dumps(x));self.image(1)
  m,f=self.collect(include_count=False,max_events=5);self.assertEqual(len(m['events']),1);self.assertEqual(len(f),2)

class PackageTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.state=self.base/'manus-bridge/state';self.state.mkdir(parents=True)
  self.mount=self.base/'external';self.root=self.mount/'evidence';self.dest=self.root/'manus-bridge-packages';self.dest.mkdir(parents=True)
  (self.base/'pilot-tools').mkdir();(self.base/'pilot-tools/session-storage.json').write_text(json.dumps({'mountPoint':str(self.mount),'sessionRootPath':str(self.root/'pilot-session-output'),'filesystemUuid':'expected-uuid'}))
  self.manifest={'schemaVersion':1,'storeId':1,'cameraName':'handoff','businessDate':'2026-10-18','events':[],'files':[],'countRecordIncluded':False,'cupsDetected':None}
  b.stage(self.manifest,{},self.state);self.db=b.queue_db(self.state);self.row=dict(self.db.execute('SELECT * FROM batches').fetchone())
 def tearDown(self):self.db.close();self.tmp.cleanup()
 def relocate(self):
  src=Path(self.row['path']);dst=self.dest/src.name;shutil.copy2(src,dst);self.row['path']=str(dst);return dst
 def mounted(self,uuid='expected-uuid'):return types.SimpleNamespace(stdout=json.dumps({'filesystems':[{'target':str(self.mount),'uuid':uuid}]}))
 def test_local_package(self):self.assertEqual(b.package_path(self.row,self.state),Path(self.row['path']))
 def test_symlink_rejected(self):
  src=Path(self.row['path']);other=src.with_suffix('.data');src.rename(other);src.symlink_to(other)
  with self.assertRaisesRegex(b.BridgeError,'package_symlink_rejected'):b.package_path(self.row,self.state)
 def test_external_receipt_and_review(self):
  dst=self.relocate()
  with patch.object(ps.os.path,'ismount',return_value=True),patch.object(ps.subprocess,'run',return_value=self.mounted()):
   self.assertEqual(rc.package_manifest(self.row,self.state)['businessDate'],'2026-10-18');self.assertEqual(pc.read_source(self.row,self.state)[1],dst)
 def test_wrong_uuid(self):
  self.relocate()
  with patch.object(ps.os.path,'ismount',return_value=True),patch.object(ps.subprocess,'run',return_value=self.mounted('wrong')):
   with self.assertRaisesRegex(b.BridgeError,'external_filesystem_identity_mismatch'):rc.package_manifest(self.row,self.state)
 def test_missing_mount(self):
  self.relocate()
  with patch.object(ps.os.path,'ismount',return_value=False),patch.object(ps.subprocess,'run') as run:
   with self.assertRaisesRegex(b.BridgeError,'external_mount_missing'):rc.package_manifest(self.row,self.state)
   run.assert_not_called()
 def test_foreign_path(self):
  dst=self.base/(self.row['id']+'.zip');shutil.copy2(self.row['path'],dst);self.row['path']=str(dst)
  with self.assertRaisesRegex(b.BridgeError,'external_source_path'):b.package_path(self.row,self.state)
 def test_corrupt_package_not_requeued(self):
  Path(self.row['path']).write_bytes(b'bad')
  with self.assertRaisesRegex(b.BridgeError,'receipt_package_integrity_failed'):rt.covered_and_active(self.db,self.state,'2026-10-18')
 def test_missing_package_fails_closed(self):
  Path(self.row['path']).unlink()
  with self.assertRaises(b.BridgeError):rt.covered_and_active(self.db,self.state,'2026-10-18')
 def test_blocked_batch_visible(self):
  self.db.execute("UPDATE batches SET status='blocked'");self.db.commit();covered,active,hold=rt.covered_and_active(self.db,self.state,'2026-10-18');self.assertEqual(active[0]['status'],'blocked')
 def test_eight_gib_reserve(self):
  with patch.object(ps.os.path,'ismount',return_value=True),patch.object(ps.subprocess,'run',return_value=self.mounted()),patch.object(ps.shutil,'disk_usage',return_value=types.SimpleNamespace(free=ps.MIN_FREE+10)):
   with self.assertRaisesRegex(ps.StorageError,'external_free_space_below_reserve'):ps.verify_external(self.base,self.dest,writable=True,required_bytes=11)
 def test_busy_retry_five_minutes(self):
  api=FakeApi();api.task_status='running';b.deliver_one(self.db,api,now=100);self.assertEqual(self.db.execute('SELECT next_at FROM batches').fetchone()[0],400)

class ThermalTests(unittest.TestCase):
 def test_running_frigate_blocks_offline(self):
  with patch.object(ps.subprocess,'run',return_value=types.SimpleNamespace(stdout='true')):
   with self.assertRaisesRegex(ps.StorageError,'offline_scan_blocked_frigate_running'):ps.offline_preflight(Path('/'))
 def test_high_temp_blocks(self):
  with patch.object(ps.subprocess,'run',return_value=types.SimpleNamespace(stdout='false')),patch.object(ps,'temperature_c',return_value=88):
   with self.assertRaisesRegex(ps.StorageError,'high_temperature'):ps.offline_preflight(Path('/'))
 def test_unknown_temp_blocks(self):
  with patch.object(ps.subprocess,'run',return_value=types.SimpleNamespace(stdout='false')),patch.object(ps,'temperature_c',return_value=None):
   with self.assertRaisesRegex(ps.StorageError,'temperature_unavailable'):ps.offline_preflight(Path('/'))
 def test_cool_stopped_allowed(self):
  with patch.object(ps.subprocess,'run',return_value=types.SimpleNamespace(stdout='false')),patch.object(ps,'temperature_c',return_value=70),patch.object(ps.shutil,'disk_usage',return_value=types.SimpleNamespace(free=20*2**30)):
   self.assertEqual(ps.offline_preflight(Path('/'))['temperatureC'],70)

if __name__=='__main__':unittest.main()

class SnapshotAndScheduleTests(unittest.TestCase):
 def test_atomic_snapshot_and_repeat(self):
  import sqlite3
  with tempfile.TemporaryDirectory() as d:
   src=Path(d)/'source.sqlite3';dst=Path(d)/'copy.sqlite3'
   with sqlite3.connect(src) as db:db.execute('CREATE TABLE evidence(id INTEGER)');db.execute('INSERT INTO evidence VALUES(7)')
   ps.snapshot_atomic(src,dst);digest=hashlib.sha256(dst.read_bytes()).hexdigest();ps.snapshot_atomic(src,dst)
   self.assertEqual(hashlib.sha256(dst.read_bytes()).hexdigest(),digest)
   with sqlite3.connect(dst) as db:self.assertEqual(db.execute('SELECT id FROM evidence').fetchone()[0],7)
 def test_corrupt_existing_snapshot_not_trusted(self):
  import sqlite3
  with tempfile.TemporaryDirectory() as d:
   dst=Path(d)/'copy.sqlite3';dst.write_bytes(b'incomplete')
   with self.assertRaises(sqlite3.DatabaseError):ps.snapshot_atomic(Path(d)/'source.sqlite3',dst)
   self.assertEqual(dst.read_bytes(),b'incomplete')
 def test_manual_session_allowed_without_changing_start_schedule(self):
  from datetime import datetime
  from zoneinfo import ZoneInfo
  import live_cycle
  wed=datetime(2026,10,21,10,0,tzinfo=ZoneInfo('America/Mazatlan'))
  self.assertEqual(live_cycle.eligible(wed,True),(True,'manual_camera_session'))
  self.assertEqual(live_cycle.eligible(wed,False),(False,'inactive'))
 def test_normal_window_and_inactive_night(self):
  from datetime import datetime
  from zoneinfo import ZoneInfo
  import live_cycle
  zone=ZoneInfo('America/Mazatlan')
  self.assertTrue(live_cycle.eligible(datetime(2026,10,23,12,tzinfo=zone),False)[0])
  self.assertFalse(live_cycle.eligible(datetime(2026,10,23,2,tzinfo=zone),False)[0])

class ReceiptCounterTests(unittest.TestCase):
 def run_case(self,status,recheck):
  with tempfile.TemporaryDirectory() as d:
   state=Path(d);b.stage({'businessDate':'2026-10-18','events':[],'countRecordIncluded':False},{},state)
   db=b.queue_db(state)
   try:
    db.execute('UPDATE batches SET status=?,sent_at=100',(status,));db.commit()
    with patch.object(rc,'receipt_messages',return_value=iter(())):
     result=rc.collect_receipts(db,FakeApi(),state,recheck=recheck)
    self.assertTrue((state/'receipt-collector-latest.json').is_file())
    return result
   finally:db.close()
 def test_old_verified_receipt_not_reported_as_pending(self):
  r=self.run_case('admin_receipt_verified',True);self.assertEqual(r['waiting'],0);self.assertEqual(r['previousReceiptsPreservedNotRefreshed'],1)
 def test_actual_pending_receipt_stays_pending(self):
  self.assertEqual(self.run_case('awaiting_dashboard_receipt',False)['waiting'],1)
 def test_no_pending_updates_current_status(self):
  self.assertEqual(self.run_case('admin_receipt_verified',False)['waiting'],0)
