import json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from size_template import source_business_date
from size_classifier import CalibrationError
class ReferenceBusinessDateTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.path=self.root/'ledger.sqlite3';self.real=sqlite3.connect;self.held=[]
  self.original={'observationId':'a'*64,'sourceEventId':'fixture-reference','startedAt':'2026-10-23T03:00:00+00:00','imageSha256':'b'*64,'targetBox':[.4,.5,.1,.1],'binding':{'deviceId':'device','cameraName':'handoff','detectorModelSha256':'c'*64,'zoneSha256':'d'*64}}
  self.row={'observationId':'a'*64,'sourceEventId':'fixture-reference','startedAt':self.original['startedAt'],'deviceId':'device','cameraName':'handoff','detectorModelSha256':'c'*64,'businessDate':'2026-10-22','sameFrameEvidence':{'imageSha256':'b'*64,'targetBox':[.4,.5,.1,.1],'sourceZoneSha256':'d'*64}}
  db=self.real(self.path);db.execute('CREATE TABLE observations(id TEXT PRIMARY KEY,payload TEXT)');db.execute('INSERT INTO observations VALUES(?,?)',('a'*64,json.dumps(self.row)));db.commit();db.close()
 def tearDown(self):
  for db in self.held:db.close()
  self.tmp.cleanup()
 def update(self):
  db=self.real(self.path);db.execute('UPDATE observations SET payload=?',(json.dumps(self.row),));db.commit();db.close()
 def test_legacy_manifest_without_date_uses_local_business_date(self):self.assertEqual(source_business_date(self.original,self.root),'2026-10-22')
 def test_never_infers_utc_day(self):self.assertNotEqual(source_business_date(self.original,self.root),self.original['startedAt'].split('T')[0])
 def test_explicit_conflicting_manifest_date_rejected(self):
  self.original['businessDate']='2026-10-23'
  with self.assertRaises(CalibrationError):source_business_date(self.original,self.root)
 def test_wrong_source_identity_rejected(self):
  self.row['sourceEventId']='other';self.update()
  with self.assertRaises(CalibrationError):source_business_date(self.original,self.root)
 def test_wrong_image_rejected(self):
  self.row['sameFrameEvidence']['imageSha256']='e'*64;self.update()
  with self.assertRaises(CalibrationError):source_business_date(self.original,self.root)
 def test_missing_reference_rejected(self):
  self.original['observationId']='e'*64
  with self.assertRaises(CalibrationError):source_business_date(self.original,self.root)
 def test_connection_is_closed_with_retained_reference(self):
  def connect(*a,**k):db=self.real(*a,**k);self.held.append(db);return db
  with patch('size_template.sqlite3.connect',side_effect=connect):source_business_date(self.original,self.root)
  with self.assertRaises(sqlite3.ProgrammingError):self.held[0].execute('SELECT 1')
 def test_original_manifest_and_database_unchanged(self):
  before=self.path.read_bytes();manifest=json.dumps(self.original);source_business_date(self.original,self.root);self.assertEqual(self.path.read_bytes(),before);self.assertEqual(json.dumps(self.original),manifest)
if __name__=='__main__':unittest.main()
