import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from export_verified_snapshot_import import convert

sha=lambda b:hashlib.sha256(b).hexdigest()


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'evidence.zip'
        self.image=b'\xff\xd8\xfffixture'
        zone={'name':'handoff_zone','coordinate_system':'normalized','membership_rule':'box_bottom_center',
              'reference_width':2304,'reference_height':1296,
              'polygon':[[.45,.55],[.609,.564],[.605,.685],[.453,.675]]}
        self.sidecar={'schema_version':3,'camera':'handoff','cup_zone':'handoff_zone','cup_event_id':'fixture-event-001',
          'captured_at_utc':'2026-10-16T21:00:25.612741+00:00','image_sha256':sha(self.image),
          'zone_geometry':zone,'zone_config_sha256':sha(json.dumps(zone,sort_keys=True,separators=(',',':')).encode()),
          'image_dimensions':{'width':2304,'height':1296}}

    def tearDown(self):self.temp.cleanup()

    def write(self,duplicate=False,bad_hash=False):
        data={'snapshots/image.jpg':self.image,'snapshots/image.json':json.dumps(self.sidecar).encode()}
        event={'cupEventId':'fixture-event-001','source':'verified_snapshot','image':'snapshots/image.jpg','metadata':'snapshots/image.json'}
        manifest={'schemaVersion':1,'storeId':1,'cameraName':'handoff','businessDate':'2026-10-16',
                  'events':[event,event] if duplicate else [event],
                  'files':[{'path':k,'bytes':len(v),'sha256':'0'*64 if bad_hash else sha(v)} for k,v in data.items()]}
        with zipfile.ZipFile(self.path,'w') as z:
            z.writestr('manifest.json',json.dumps(manifest))
            for k,v in data.items():z.writestr(k,v)

    def test_preserves_original_package_and_raw_sidecar_with_correct_wire_hash(self):
        self.write();before=self.path.read_bytes();doc,summary=convert(self.path)
        item=doc['items'][0]
        self.assertEqual(item['capture']['zone_config_sha256'],'0c5239aac1c6d946af3a6f07319c91afcb1565acf58cb0433e18680c86e8d772')
        self.assertEqual(item['normalizationProof']['sourceMetadataJson'],json.dumps(self.sidecar))
        self.assertEqual(self.path.read_bytes(),before)
        self.assertFalse(doc['productionCountsEligible'])
        self.assertNotIn('storeId',doc)
        self.assertNotIn('cupsDetected',doc)

    def test_rejects_package_tampering(self):
        self.write(bad_hash=True)
        with self.assertRaisesRegex(ValueError,'package_hash'):convert(self.path)

    def test_rejects_wrong_source_zone_hash(self):
        self.sidecar['zone_config_sha256']='0'*64;self.write()
        with self.assertRaisesRegex(Exception,'zone_config_sha256'):convert(self.path)

    def test_rejects_duplicate_event_identity(self):
        self.write(duplicate=True)
        with self.assertRaisesRegex(ValueError,'capture_identity'):convert(self.path)

    def test_rejects_changed_capture_date(self):
        self.sidecar['captured_at_utc']='2026-10-15T21:00:00+00:00';self.write()
        with self.assertRaisesRegex(ValueError,'capture_business_date'):convert(self.path)


if __name__=='__main__':unittest.main()
