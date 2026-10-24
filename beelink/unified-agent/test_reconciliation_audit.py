import unittest,copy
from reconciliation_audit import reconcile
DAY='2026-10-23';PERIOD={'start':'2026-10-23T12:00:00-07:00','end':'2026-10-23T21:00:00-07:00'}
def sources():
 m={'storeId':1,'businessDate':DAY,'reportCount':1,'source':'manual_closing','cups':{'4oz':12,'8oz':4,'Pint':3,'Liter':0},'cupsHere':{'4oz':2,'8oz':4,'Pint':0,'Liter':0},'cupsToGo':{'4oz':10,'8oz':0,'Pint':3,'Liter':0}}
 n={'storeId':1,'businessDate':DAY,'detectedTracks':57,'locallyVerifiedTargets':21,'sizeBreakdown':{'chico':2,'mediano':5,'pint':0,'litro':0,'unknown':14}}
 return m,n
class ReconciliationTests(unittest.TestCase):
 def test_friday_actual_semantics_no_fake_accuracy(self):
  m,n=sources();r=reconcile(DAY,1,m,n);self.assertEqual(r['manualClosingTotal'],19);self.assertEqual(r['cameraUsableObservations'],21);self.assertIsNone(r['relativeDifferencePct']);self.assertFalse(r['comparable'])
 def test_observations_cannot_be_used_for_difference(self):
  m,n=sources();r=reconcile(DAY,1,m,n);self.assertIsNone(r['cameraMinusManual']);self.assertIn('unique_camera_count_not_validated',r['blockingReasons'])
 def test_known_zero_kept(self):
  m,n=sources();self.assertEqual(reconcile(DAY,1,m,n)['rows'][3]['manualClosing'],0)
 def test_missing_closing_not_zero(self):
  m,n=sources();m['reportCount']=0;self.assertIsNone(reconcile(DAY,1,m,n)['manualClosingTotal'])
 def test_other_date_rejected(self):
  m,n=sources();m['businessDate']='2026-10-22'
  with self.assertRaises(ValueError):reconcile(DAY,1,m,n)
 def test_other_store_rejected(self):
  m,n=sources();n['storeId']=2
  with self.assertRaises(ValueError):reconcile(DAY,1,m,n)
 def test_missing_mode_never_inferred(self):
  m,n=sources();r=reconcile(DAY,1,m,n);self.assertTrue(all(c['uniqueCameraCups'] is None for c in r['sixCategories']))
 def test_missing_pos_never_inferred_from_manual(self):
  m,n=sources();self.assertTrue(all(c['shopify'] is None for c in reconcile(DAY,1,m,n)['sixCategories']))
 def test_manual_closing_not_rayitas(self):
  m,n=sources();self.assertFalse(reconcile(DAY,1,m,n)['manualClosingIsIndependentTally'])
 def test_positive_comparable_case(self):
  m,n=sources();m['period']=PERIOD;p={'storeId':1,'businessDate':DAY,'kind':'validated_unique_cups','coverage':'complete','count':18,'period':PERIOD}
  r=reconcile(DAY,1,m,n,p);self.assertTrue(r['comparable']);self.assertEqual(r['cameraMinusManual'],-1);self.assertAlmostEqual(r['relativeDifferencePct'],-5.2632)
 def test_partial_not_certified(self):
  m,n=sources();m['period']=PERIOD;p={'storeId':1,'businessDate':DAY,'kind':'validated_unique_cups','coverage':'partial','count':18,'period':PERIOD}
  self.assertFalse(reconcile(DAY,1,m,n,p)['comparable'])
 def test_interval_mismatch_blocks_percent(self):
  m,n=sources();m['period']=PERIOD;p={'storeId':1,'businessDate':DAY,'kind':'validated_unique_cups','coverage':'complete','count':18,'period':dict(PERIOD,end='2026-10-23T20:00:00-07:00')}
  self.assertIsNone(reconcile(DAY,1,m,n,p)['relativeDifferencePct'])
 def test_zero_denominator_not_percent(self):
  m,n=sources();m.update(period=PERIOD,cups={k:0 for k in m['cups']});p={'storeId':1,'businessDate':DAY,'kind':'validated_unique_cups','coverage':'complete','count':0,'period':PERIOD}
  r=reconcile(DAY,1,m,n,p);self.assertEqual(r['cameraMinusManual'],0);self.assertIsNone(r['relativeDifferencePct'])
 def test_unclassified_visible(self):
  m,n=sources();self.assertEqual(reconcile(DAY,1,m,n)['cameraUnclassifiedObservations'],14)
 def test_invalid_sum_not_displayed(self):
  m,n=sources();n['locallyVerifiedTargets']=57
  with self.assertRaises(ValueError):reconcile(DAY,1,m,n)
 def test_inputs_unchanged(self):
  m,n=sources();orig=copy.deepcopy((m,n));reconcile(DAY,1,m,n);self.assertEqual((m,n),orig)
if __name__=='__main__':unittest.main()
