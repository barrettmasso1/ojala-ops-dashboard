import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import pilot_session as p

class SessionStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'root';self.root.mkdir()
        self.mount=Path(self.temp.name)/'external';self.mount.mkdir()
        self.target=self.mount/'sessions';self.target.mkdir()
        (self.root/'pilot-tools').mkdir()
    def configure(self,uuid='expected'):
        (self.root/'local-simulations').symlink_to(self.target)
        (self.root/'pilot-tools'/'session-storage.json').write_text(json.dumps({'mountPoint':str(self.mount),'sessionRootPath':str(self.target),'filesystemUuid':uuid}))
    def findmnt(self,uuid='expected'):
        return subprocess.CompletedProcess([],0,json.dumps({'filesystems':[{'target':str(self.mount),'uuid':uuid}]}),'')
    def test_existing_internal_storage_unchanged(self):
        p.verify_session_storage(self.root)
    def test_relocated_storage_requires_config(self):
        (self.root/'local-simulations').symlink_to(self.target)
        with self.assertRaisesRegex(ValueError,'config_missing'):p.verify_session_storage(self.root)
    def test_correct_mount_accepted(self):
        self.configure()
        with patch.object(p.os.path,'ismount',return_value=True),patch.object(p.subprocess,'run',return_value=self.findmnt()):p.verify_session_storage(self.root)
    def test_wrong_disk_rejected(self):
        self.configure()
        with patch.object(p.os.path,'ismount',return_value=True),patch.object(p.subprocess,'run',return_value=self.findmnt('other')):
            with self.assertRaisesRegex(ValueError,'identity_mismatch'):p.verify_session_storage(self.root)
    def test_unmounted_collection_has_no_external_or_database_write(self):
        self.configure()
        with patch.object(p.os.path,'ismount',return_value=False),patch.object(p,'readonly') as db:
            result=p.collect('2026-10-17',self.root)
        self.assertEqual(result['status'],'blocked_storage_unavailable');db.assert_not_called()
        self.assertFalse((self.target/'sessions').exists())
        self.assertTrue((self.root/'pilot-tools'/'pilot-session-storage-status.json').exists())
    def test_changed_symlink_target_rejected(self):
        self.configure();other=self.mount/'other';other.mkdir()
        (self.root/'local-simulations').unlink();(self.root/'local-simulations').symlink_to(other)
        with patch.object(p.os.path,'ismount',return_value=True):
            with self.assertRaisesRegex(ValueError,'changed'):p.verify_session_storage(self.root)
    def test_source_database_remains_read_only(self):
        import sqlite3
        path=self.root/'source.db';db=sqlite3.connect(path);db.execute('CREATE TABLE sample(value)');db.commit();db.close()
        db=p.readonly(path)
        try:
            with self.assertRaises(sqlite3.OperationalError):db.execute('INSERT INTO sample VALUES(1)')
        finally:db.close()

if __name__=='__main__':unittest.main()
