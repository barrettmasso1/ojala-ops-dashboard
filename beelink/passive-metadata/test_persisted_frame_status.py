import unittest,sqlite3
from datetime import datetime
from record_frames import latest_saved_frame,frame_health
class PersistentFrameStatus(unittest.TestCase):
 def setUp(self):self.db=sqlite3.connect(':memory:');self.db.execute('CREATE TABLE frames(frame_at REAL)');self.now=1800000000.
 def tearDown(self):self.db.close()
 def test_empty_remains_unknown(self):self.assertIsNone(latest_saved_frame(self.db))
 def test_max_saved_frame_retained(self):
  self.db.executemany('INSERT INTO frames VALUES(?)',[(self.now-40,),(self.now-20,)]);self.assertEqual(latest_saved_frame(self.db),self.now-20)
 def test_old_frame_does_not_mean_live_video(self):
  r=frame_health(self.now-400,None,self.now);self.assertEqual(r['status'],'waiting_for_live_frames');self.assertEqual(r['lastFrameSource'],'persisted_history');self.assertEqual(r['lastFrameAgeSeconds'],400)
 def test_even_recent_saved_frame_needs_new_live_frame(self):self.assertEqual(frame_health(self.now-1,None,self.now)['status'],'waiting_for_live_frames')
 def test_actual_live_frame_is_receiving(self):r=frame_health(self.now-1,self.now-1,self.now);self.assertEqual(r['status'],'receiving');self.assertTrue(r['liveFrameSeenThisRun'])
 def test_stopped_live_frame_becomes_waiting(self):self.assertEqual(frame_health(self.now-6,self.now-6,self.now)['status'],'waiting_for_live_frames')
 def test_missing_history_not_zero_epoch(self):r=frame_health(None,None,self.now);self.assertIsNone(r['lastFrameAt']);self.assertIsNone(r['lastFrameAgeSeconds'])
 def test_future_not_receiving(self):self.assertEqual(frame_health(self.now+20,self.now+20,self.now)['status'],'waiting_for_live_frames')
 def test_database_is_read_only_by_helper(self):
  self.db.execute('INSERT INTO frames VALUES(?)',(self.now,));before=self.db.total_changes;latest_saved_frame(self.db);self.assertEqual(before,self.db.total_changes)
 def test_invalid_history_rejected(self):
  self.db.execute('INSERT INTO frames VALUES(?)',(-1,))
  with self.assertRaises(ValueError):latest_saved_frame(self.db)
 def test_stored_time_is_timezone_bearing(self):r=frame_health(self.now,None,self.now);self.assertIsNotNone(datetime.fromisoformat(r['lastFrameAt']).tzinfo)
if __name__=='__main__':unittest.main()
