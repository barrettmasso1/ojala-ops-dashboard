import unittest,time,datetime
from demo_check import freshness,safe_error
class PreflightTests(unittest.TestCase):
 def test_fresh_aware(self):
  now=time.time();self.assertTrue(freshness({'checkedAt':datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat()},now)['fresh'])
 def test_missing_never_fresh(self):self.assertFalse(freshness({},time.time())['fresh'])
 def test_stale_not_fresh(self):self.assertFalse(freshness({'checkedAt':'2020-01-01T00:00:00Z'},time.time())['fresh'])
 def test_future_not_fresh(self):self.assertFalse(freshness({'checkedAt':'2099-01-01T00:00:00Z'},time.time())['fresh'])
 def test_unavailable_not_zero(self):self.assertIsNone(freshness({},time.time())['ageSeconds'])
 def test_sensitive_error_not_printed(self):self.assertEqual(safe_error(ValueError('token secret fixture')),'ValueError')
 def test_url_error_not_printed(self):self.assertEqual(safe_error(ValueError('https://fixture.invalid/private')),'ValueError')
 def test_naive_time_rejected(self):self.assertFalse(freshness({'checkedAt':'2026-11-01T18:00:00'},time.time())['fresh'])
 def test_simple_error_retained(self):self.assertEqual(safe_error(ValueError('http_500')),'http_500')
if __name__=='__main__':unittest.main()
