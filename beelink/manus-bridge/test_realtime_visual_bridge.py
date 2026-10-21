import unittest
import realtime_visual_bridge as r


class RealtimeSubsetTest(unittest.TestCase):
    def test_subset_is_visual_only_and_keeps_only_selected_files(self):
        manifest={
            'schemaVersion':1,'storeId':1,'cameraName':'handoff','businessDate':'2026-10-23',
            'countRecordIncluded':True,'countRecord':{'cupsDetected':9},'cupsDetected':9,
            'events':[
                {'cupEventId':'a','capturedAt':'2026-10-23T19:00:00+00:00','image':'snapshots/a.jpg','metadata':'snapshots/a.json','segments':[{'path':'segments/a.mp4'}]},
                {'cupEventId':'b','capturedAt':'2026-10-23T19:01:00+00:00','image':'snapshots/b.jpg','metadata':'snapshots/b.json','segments':[{'path':'segments/b.mp4'}]},
            ],
            'files':[],'limitations':[]
        }
        files={name:name.encode() for name in ['snapshots/a.jpg','snapshots/a.json','segments/a.mp4','snapshots/b.jpg','snapshots/b.json','segments/b.mp4']}
        subset, selected=r.build_subset(manifest,files,[manifest['events'][1]])
        self.assertEqual(subset['selectedEventIds'],['b'])
        self.assertFalse(subset['countRecordIncluded'])
        self.assertIsNone(subset['countRecord'])
        self.assertIsNone(subset['cupsDetected'])
        self.assertEqual(set(selected),{'snapshots/b.jpg','snapshots/b.json','segments/b.mp4'})
        self.assertNotIn('snapshots/a.jpg',selected)

    def test_event_files_deduplicate_overlapping_segments(self):
        event={'image':'snapshots/a.jpg','metadata':'snapshots/a.json','segments':[{'path':'segments/x.mp4'},{'path':'segments/x.mp4'}]}
        self.assertEqual(r.event_file_names(event),{'snapshots/a.jpg','snapshots/a.json','segments/x.mp4'})


if __name__=='__main__': unittest.main()
