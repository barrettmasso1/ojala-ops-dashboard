import hashlib,json,sqlite3,tempfile,unittest
from pathlib import Path
from shadow_core import associate,valid_box,nms,healthy_for_shadow
from rescue_shadow import Journal

BOX=[.47,.56,.035,.07]
GEOM=[[.45,.55],[.609,.564],[.605,.685],[.453,.675]]
D={'box':BOX,'score':.8}
RESULT={'cups':[D],'people':[{'box':[.4,.2,.6,.9],'score':.9}],'width':2304,'height':1296,'eligible':True}

class ShadowSafety(unittest.TestCase):
    def test_distinct_cups_cannot_join_one_track(self):
        old=[{'id':'old','box':BOX,'last_seen':10}]
        matches=associate(old,[D,{'box':[.49,.56,.035,.07],'score':.7}],11)
        self.assertEqual(len(matches),1)
    def test_scale_independent_polygon(self):
        self.assertTrue(valid_box(BOX,GEOM,2304,1296,2000,50000))
        self.assertFalse(valid_box([.1,.1,.1,.1],GEOM,2304,1296,2000,50000))
        self.assertFalse(valid_box([float('nan'),.5,.1,.1],GEOM,2304,1296,2000,50000))
    def test_nms_retains_two_separate_cups(self):
        self.assertEqual(len(nms([D,{**D,'score':.6},{'box':[.53,.56,.035,.07],'score':.7}])),2)
    def test_load_pauses_when_primary_drops(self):
        self.assertTrue(healthy_for_shadow({'detection_enabled':True,'camera_fps':5,'process_fps':5,'skipped_fps':0}))
        self.assertFalse(healthy_for_shadow({'detection_enabled':True,'camera_fps':5,'process_fps':3,'skipped_fps':2}))
        self.assertFalse(healthy_for_shadow({}))
    def test_gap_starts_new_track(self):
        self.assertEqual(associate([{'id':'a','box':BOX,'last_seen':1}],[D],20),{})
    def test_two_frames_required_and_restart_deduplicated(self):
        with tempfile.TemporaryDirectory() as root:
            j=Journal(root,'zone');t=j.advance([D],100)
            self.assertIsNone(j.save(b'frame1',RESULT,t,100,'independent_live_shadow'))
            t=j.advance([D],103);saved=j.save(b'frame2',RESULT,t,103,'independent_live_shadow');self.assertIsNotNone(saved);j.close()
            j=Journal(root,'zone');t=j.advance([D],106)
            self.assertIsNone(j.save(b'frame3',RESULT,t,106,'independent_live_shadow'))
            self.assertEqual(j.db.execute('SELECT count(*) FROM candidates').fetchone()[0],1);j.close()
    def test_no_person_never_saves(self):
        with tempfile.TemporaryDirectory() as root:
            j=Journal(root,'zone');j.advance([D],100);t=j.advance([D],103)
            self.assertIsNone(j.save(b'frame',{**RESULT,'people':[],'eligible':False},t,103,'independent_live_shadow'));j.close()
            self.assertFalse((Path(root)/'pending').exists())
    def test_missing_frame_breaks_consecutive_hits(self):
        with tempfile.TemporaryDirectory() as root:
            j=Journal(root,'zone');j.advance([D],100);j.advance([],103);t=j.advance([D],106)
            self.assertEqual(t[0]['hits'],1);j.close()
    def test_completed_pair_recovers_after_lost_database_commit(self):
        with tempfile.TemporaryDirectory() as root:
            j=Journal(root,'zone');j.advance([D],100);t=j.advance([D],103)
            saved=j.save(b'complete',RESULT,t,103,'independent_live_shadow')
            j.db.execute('DELETE FROM candidates');j.db.execute('UPDATE tracks SET emitted=0');j.db.commit();j.close()
            j=Journal(root,'zone');self.assertEqual(j.db.execute('SELECT id FROM candidates').fetchone()[0],saved)
            self.assertTrue(j.db.execute('SELECT emitted FROM tracks').fetchone()[0]);j.close()
    def test_recovered_source_never_impersonates_frigate(self):
        with tempfile.TemporaryDirectory() as root:
            j=Journal(root,'zone');j.advance([D],100);t=j.advance([D],103)
            saved=j.save(b'recovered',RESULT,t,103,'recording_extracted_frame',{'video_sha256':'source','offset_seconds':346});j.close()
            m=json.loads((Path(root)/'pending'/(saved+'.json')).read_text())
            self.assertIsNone(m['cup_event_id']);self.assertFalse(m['delivery_confirmed']);self.assertEqual(m['status'],'pending_review')

if __name__=='__main__':unittest.main()
