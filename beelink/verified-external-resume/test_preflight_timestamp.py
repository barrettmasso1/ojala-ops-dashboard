import unittest,datetime
from demo_check import freshness
class TimestampPrecision(unittest.TestCase):
 def test_iso_microsecond_rounding_is_not_future_data(self):
  for i in range(1000):
   now=1793661900.0+i*.0000011
   stamp=datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat()
   self.assertTrue(freshness({'checkedAt':stamp},now)['fresh'])
 def test_real_future_timestamp_rejected(self):
  now=1793661900.;stamp=datetime.datetime.fromtimestamp(now+.01,datetime.timezone.utc).isoformat()
  self.assertFalse(freshness({'checkedAt':stamp},now)['fresh'])
 def test_expired_data_stays_expired(self):
  now=1793661900.;stamp=datetime.datetime.fromtimestamp(now-181,datetime.timezone.utc).isoformat()
  self.assertFalse(freshness({'checkedAt':stamp},now)['fresh'])
if __name__=='__main__':unittest.main()
