import unittest
import export_review_context as c


class ContextTest(unittest.TestCase):
    def test_overlapping_windows_merge_without_duplicate_sources(self):
        events = [{'cupEventId': 'one', 'capturedAt': '2026-10-16T21:00:00Z'},
                  {'cupEventId': 'two', 'capturedAt': '2026-10-16T21:01:30Z'},
                  {'cupEventId': 'three', 'capturedAt': '2026-10-16T21:07:00Z'}]
        windows = c.merge_windows(events)
        self.assertEqual([w['eventIds'] for w in windows], [['one', 'two'], ['three']])
        self.assertEqual(windows[0]['endTime'] - windows[0]['startTime'], 270)

    def test_gaps_include_missing_edges_and_subsecond_interruption(self):
        segments = [{'startTime': 2, 'endTime': 5}, {'startTime': 5.2, 'endTime': 8}]
        gaps = c.coverage_gaps(0, 10, segments)
        self.assertEqual(len(gaps), 3)
        self.assertAlmostEqual(sum(g['seconds'] for g in gaps), 4.2)

    def test_overlapping_segments_do_not_invent_negative_gaps(self):
        segments = [{'startTime': -2, 'endTime': 6}, {'startTime': 4, 'endTime': 12}]
        self.assertEqual(c.coverage_gaps(0, 10, segments), [])

    def test_playback_splits_large_gaps_and_overlaps(self):
        segments = [{'startTime': 0, 'endTime': 10}, {'startTime': 10.1, 'endTime': 20},
                    {'startTime': 21, 'endTime': 30}, {'startTime': 28, 'endTime': 40}]
        self.assertEqual([len(g) for g in c.split_for_playback(segments)], [2, 1, 1])

    def test_empty_window_is_entirely_missing(self):
        self.assertEqual(c.coverage_gaps(10, 20, []), [{'startTime': 10, 'endTime': 20, 'seconds': 10}])


if __name__ == '__main__':
    unittest.main()
