import gc,json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import calibration as target

class ReadConnectionLifecycle(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.path=self.root/'ledger.sqlite3';self.real_connect=sqlite3.connect;self.connections=[]
  db=self.real_connect(self.path);db.executescript("CREATE TABLE observations(id TEXT,day TEXT,revision INTEGER,payload_sha TEXT,payload TEXT,first_seen TEXT);CREATE TABLE outbox(id TEXT,revision INTEGER,payload_sha TEXT,status TEXT);")
  self.payload={'deviceId':'device-test','cameraName':'handoff','verification':'detector_track_only','sameFrameEvidence':None}
  db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?)',('a','2026-10-25',1,'hash',json.dumps(self.payload),'2026-10-25'))
  db.execute('INSERT INTO outbox VALUES(?,?,?,?)',('a',1,'hash','acknowledged'));db.commit();db.close()
 def tearDown(self):
  for db in self.connections:db.close()
  self.temp.cleanup()
 def connect(self,*args,**kwargs):
  db=self.real_connect(*args,**kwargs);self.connections.append(db);return db
 def run_reader(self):return target.load_samples(self.root,self.root/'output')
 def assertClosed(self):
  self.assertTrue(self.connections)
  for db in self.connections:
   with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')
 def test_read_returns_and_closes_without_garbage_collection(self):
  with patch.object(target.sqlite3,'connect',side_effect=self.connect):self.run_reader()
  self.assertClosed()
 def test_three_hundred_polls_hold_no_open_read_connections(self):
  enabled=gc.isenabled();gc.disable()
  try:
   with patch.object(target.sqlite3,'connect',side_effect=self.connect):
    for _ in range(300):self.run_reader()
   self.assertEqual(len(self.connections),300);self.assertClosed()
  finally:
   if enabled:gc.enable()
 def test_sql_exception_still_closes(self):
  db=self.real_connect(self.path);db.execute('DROP TABLE observations');db.close()
  with patch.object(target.sqlite3,'connect',side_effect=self.connect):
   with self.assertRaises(sqlite3.OperationalError):self.run_reader()
  self.assertClosed()
 def test_invalid_json_still_closes(self):
  db=self.real_connect(self.path);db.execute("UPDATE observations SET payload='bad-json'");db.commit();db.close()
  with patch.object(target.sqlite3,'connect',side_effect=self.connect):
   with self.assertRaises(ValueError):self.run_reader()
  self.assertClosed()
 def test_reader_never_changes_source(self):
  before=self.path.read_bytes()
  with patch.object(target.sqlite3,'connect',side_effect=self.connect):self.run_reader()
  self.assertEqual(self.path.read_bytes(),before);self.assertClosed()
if __name__=='__main__':unittest.main()
