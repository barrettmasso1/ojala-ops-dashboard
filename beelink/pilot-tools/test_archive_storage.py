import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from archive_recordings import archive_once, verify_storage


class StorageGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'home'
        self.root.mkdir()
        (self.root / 'pilot-tools').mkdir()
        (self.root / 'pilot-archive').mkdir()
        self.mount = Path(self.temp.name) / 'disk'
        self.target = self.mount / 'evidence'
        self.target.mkdir(parents=True)
        self.archive = self.root / 'pilot-archive/forward-20260929'
        self.archive.symlink_to(self.target)
        self.config = self.root / 'pilot-tools/archive-storage.json'
        self.config.write_text(json.dumps({'mountPoint': str(self.mount),
            'archivePath': str(self.target), 'filesystemUuid': 'real-disk-uuid'}))

    def tearDown(self):
        self.temp.cleanup()

    def mount_result(self, uuid='real-disk-uuid', target=None):
        return SimpleNamespace(stdout=json.dumps({'filesystems': [
            {'target': target or str(self.mount), 'uuid': uuid}]}))

    def test_correct_disk_accepted(self):
        with patch('archive_recordings.os.path.ismount', return_value=True), \
                patch('archive_recordings.subprocess.run', return_value=self.mount_result()):
            verify_storage(self.root, self.archive)

    def test_unmounted_disk_never_creates_archive_or_opens_source_db(self):
        with patch('archive_recordings.os.path.ismount', return_value=False), \
                patch('archive_recordings.sqlite3.connect') as db:
            result = archive_once(self.root)
        self.assertEqual(result['status'], 'paused_storage_unavailable')
        db.assert_not_called()
        self.assertEqual(list(self.target.iterdir()), [])
        saved = json.loads((self.root/'pilot-tools/archive-storage-status.json').read_text())
        self.assertEqual(saved['copied_segments'], 0)

    def test_other_disk_with_same_mountpoint_rejected(self):
        with patch('archive_recordings.os.path.ismount', return_value=True), \
                patch('archive_recordings.subprocess.run', return_value=self.mount_result('wrong-disk')):
            with self.assertRaises(ValueError): verify_storage(self.root, self.archive)

    def test_fallback_root_filesystem_rejected(self):
        with patch('archive_recordings.os.path.ismount', return_value=True), \
                patch('archive_recordings.subprocess.run', return_value=self.mount_result(target='/')):
            with self.assertRaises(ValueError): verify_storage(self.root, self.archive)

    def test_lost_configuration_cannot_silently_use_symlink(self):
        self.config.unlink()
        with self.assertRaises(ValueError): verify_storage(self.root, self.archive)

    def test_changed_symlink_destination_rejected(self):
        other = self.mount/'other'; other.mkdir()
        self.archive.unlink(); self.archive.symlink_to(other)
        with patch('archive_recordings.os.path.ismount', return_value=True):
            with self.assertRaises(ValueError): verify_storage(self.root, self.archive)

    def test_legacy_nonrelocated_archive_needs_no_config(self):
        self.archive.unlink(); self.config.unlink()
        verify_storage(self.root, self.archive)


if __name__ == '__main__': unittest.main()
