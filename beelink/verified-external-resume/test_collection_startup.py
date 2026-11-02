import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from collector import collect_current_first
class StartupOrder(unittest.TestCase):
 def setUp(self):
  self.calls=[];self.output=[];self.present=True;self.fail_previous=False
  self.query=Mock();self.query.execute.return_value.fetchone.side_effect=lambda: (1,) if self.present else None
  self.c=SimpleNamespace(config={'emergencyStartDate':'2026-10-30'},db=SimpleNamespace(db=self.query),cycle=self.cycle)
 def cycle(self,day,publish_health=True):
  self.calls.append((day,publish_health))
  if self.fail_previous and not publish_health:raise OSError('private-data-must-not-be-logged')
  return {'businessDate':day,'status':'recording_local_observations','changedObservations':1}
 def run_pass(self,last=None,explicit=None,today='2026-11-02'):
  return collect_current_first(self.c,today,last,explicit,self.output.append)
 def test_today_first_before_history(self):self.run_pass();self.assertEqual(self.calls,[('2026-11-02',True),('2026-11-01',False)])
 def test_current_result_is_returned(self):r,day=self.run_pass();self.assertEqual(r['businessDate'],'2026-11-02');self.assertEqual(day,'2026-11-02')
 def test_prior_pass_does_not_publish_current_heartbeat(self):self.run_pass();self.assertFalse(self.calls[1][1])
 def test_prior_failure_preserves_current_result(self):
  self.fail_previous=True;r,_=self.run_pass();self.assertEqual(r['businessDate'],'2026-11-02');self.assertEqual(self.output[-1]['reason'],'OSError');self.assertNotIn('private-data',str(self.output))
 def test_same_day_does_not_reconcile_again(self):self.run_pass(last='2026-11-02');self.assertEqual(len(self.calls),1)
 def test_missing_prior_data_skipped(self):self.present=False;self.run_pass();self.assertEqual(len(self.calls),1)
 def test_scope_does_not_reopen_earlier_dates(self):self.run_pass(today='2026-10-30');self.assertEqual(self.calls,[('2026-10-30',True)])
 def test_explicit_date_no_other_dates(self):self.run_pass(explicit='2026-10-31');self.assertEqual(self.calls,[('2026-10-31',True)])
 def test_current_failure_not_hidden(self):
  self.c.cycle=Mock(side_effect=ValueError('current failed'))
  with self.assertRaises(ValueError):self.run_pass()
  self.assertEqual(self.output,[])
 def test_midnight_preserves_previous_business_date(self):self.run_pass(last='2026-11-01');self.assertEqual(self.calls[1][0],'2026-11-01')
if __name__=='__main__':unittest.main()
