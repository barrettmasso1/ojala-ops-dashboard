import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest
from archive_recordings import archive_once, SINCE, recording_paths, copy_checked


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root/'config').mkdir()
        self.path = '/media/frigate/recordings/2026-09-29/20/handoff/01.00.mp4'
        self.src = self.root/'storage/recordings/2026-09-29/20/handoff/01.00.mp4'
        self.src.parent.mkdir(parents=True)
        self.src.write_bytes(b'synthetic-segment')
        self.dbpath = self.root/'config/frigate.db'
        db = sqlite3.connect(self.dbpath)
        db.execute('CREATE TABLE recordings(path,start_time,end_time,camera)')
        db.execute('INSERT INTO recordings VALUES(?,?,?,?)', (self.path,SINCE+1,SINCE+11,'handoff'))
        db.commit(); db.close()
        self.archive = self.root/'pilot-archive/forward-20260929'

    def tearDown(self):
        self.temp.cleanup()

    def run_archive(self, **kw):
        return archive_once(self.root, now=SINCE+100, min_free=0, **kw)

    def test_copy_survives_source_retention_and_does_not_modify_db(self):
        original = self.dbpath.read_bytes()
        result = self.run_archive()
        self.assertEqual(result['copied_segments'], 1)
        self.assertEqual(self.dbpath.read_bytes(), original)
        dst = next((self.archive/'recordings').rglob('*.mp4'))
        self.assertEqual(dst.read_bytes(), self.src.read_bytes())
        self.src.unlink()  # synthetic fixture simulates Frigate expiration
        self.assertEqual(self.run_archive()['archived_segments'], 1)
        self.assertTrue(dst.exists())

    def test_recent_unfinished_segment_waits(self):
        r = archive_once(self.root, now=SINCE+20, min_free=0)
        self.assertEqual(r['copied_segments'], 0)

    def test_budget_stops_without_deleting_original(self):
        r = self.run_archive(max_bytes=1)
        self.assertEqual(r['status'], 'paused_storage_limit')
        self.assertTrue(self.src.exists())

    def test_low_free_space_stops(self):
        r = archive_once(self.root, now=SINCE+100, min_free=10**20)
        self.assertEqual(r['status'], 'paused_storage_limit')

    def test_retry_recovers_file_after_lost_index_commit(self):
        self.run_archive()
        db = sqlite3.connect(self.archive/'index.sqlite3')
        db.execute('DELETE FROM segments'); db.commit(); db.close()
        r = self.run_archive()
        self.assertEqual(r['copied_segments'], 0)
        self.assertEqual(r['indexed_existing'], 1)
        self.assertEqual(self.run_archive()['copied_segments'], 0)

    def test_conflict_cannot_overwrite_evidence(self):
        self.run_archive()
        dst = next((self.archive/'recordings').rglob('*.mp4'))
        before = dst.read_bytes()
        self.src.write_bytes(b'changed')
        with self.assertRaises(ValueError): copy_checked(self.src,dst)
        self.assertEqual(dst.read_bytes(),before)

    def test_traversal_and_other_camera_rejected(self):
        for bad in ['/etc/passwd','/media/frigate/recordings/../secret.mp4',
                    '/media/frigate/recordings/2026-09-29/20/entrance/a.mp4']:
            with self.assertRaises(ValueError): recording_paths(self.root,self.archive,bad)

    def test_source_symlink_rejected(self):
        self.src.rename(self.src.with_suffix('.original'))
        self.src.symlink_to(self.src.with_suffix('.original'))
        with self.assertRaises(ValueError): recording_paths(self.root,self.archive,self.path)


if __name__ == '__main__': unittest.main()
