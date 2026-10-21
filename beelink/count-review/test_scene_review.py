import copy,unittest
from validate_scene_review import validate

def sample():
 day='2026-10-18';frames=[{'at':day+'T18:06:'+t+'-07:00','sha256':str(i)*64,'source':'segment-'+str(i//2)} for i,t in enumerate(['00','10','20','30'])]
 unit={'id':'new-1','date':day,'humanApproved':False,'productionEligible':False,'firstPlacement':'18:06:10','collectionBy':'18:06:30','reason':'TEST ONLY: distinct serving lifecycle','evidence':frames}
 doc={'productionCountWrites':0,'approvedCountsWritten':False,'newServingEpisodes':[unit],'sceneDispositions':[{'date':day,'sceneId':'s1','decision':'new_serving_evidence','linkedUnitIds':['new-1']},{'date':day,'sceneId':'s2','decision':'repeat_existing','linkedUnitIds':['old-1']}],'proposedLocalLowerBounds':{day:{'proposedLocalUnits':2,'dailyTotal':None,'coverage':'partial','productionImported':False,'humanApproved':False}}}
 return doc,{day:{'units':[{'id':'old-1'}]}}
class Tests(unittest.TestCase):
 def rejects(self,change,text):
  d,b=sample();change(d,b)
  with self.assertRaisesRegex(ValueError,text):validate(d,b)
 def test_valid_review_is_not_approval(self):
  d,b=sample();r=validate(d,b);self.assertEqual(r['newEpisodes'],1);self.assertFalse(r['productionEligible']);self.assertFalse(r['dailyTotalsCertified'])
 def test_duplicate_unit(self):self.rejects(lambda d,b:d['newServingEpisodes'].append(copy.deepcopy(d['newServingEpisodes'][0])),'duplicate_new_unit')
 def test_duplicate_baseline(self):self.rejects(lambda d,b:b['2026-10-18']['units'].append({'id':'old-1'}),'duplicate_baseline_id')
 def test_duplicate_scene(self):self.rejects(lambda d,b:d['sceneDispositions'].append(copy.deepcopy(d['sceneDispositions'][0])),'duplicate_scene')
 def test_return_never_adds(self):self.rejects(lambda d,b:d['sceneDispositions'][0].update(decision='return_or_identity_unresolved'),'non_countable_case_has_units')
 def test_false_positive_never_adds(self):self.rejects(lambda d,b:d['sceneDispositions'][0].update(decision='non_cup_observation'),'non_countable_case_has_units')
 def test_ambiguous_never_adds(self):self.rejects(lambda d,b:d['sceneDispositions'][0].update(decision='ambiguous_no_addition'),'non_countable_case_has_units')
 def test_unknown_reference(self):self.rejects(lambda d,b:d['sceneDispositions'][1].update(linkedUnitIds=['unknown']),'unknown_unit_reference')
 def test_no_full_day_claim(self):self.rejects(lambda d,b:d['proposedLocalLowerBounds']['2026-10-18'].update(dailyTotal=2),'partial_not_daily_total')
 def test_no_fake_human(self):self.rejects(lambda d,b:d['newServingEpisodes'][0].update(humanApproved=True),'approval_not_permitted')
 def test_no_publish(self):self.rejects(lambda d,b:d['proposedLocalLowerBounds']['2026-10-18'].update(productionImported=True),'proposal_cannot_be_approval')
 def test_no_arithmetic_inflation(self):self.rejects(lambda d,b:d['proposedLocalLowerBounds']['2026-10-18'].update(proposedLocalUnits=20),'proposal_count_mismatch')
 def test_context_required(self):self.rejects(lambda d,b:d['newServingEpisodes'][0]['evidence'].pop(),'temporal_context_missing')
 def test_wrong_day(self):self.rejects(lambda d,b:d['newServingEpisodes'][0]['evidence'][0].update(at='2026-10-17T18:06:00-07:00'),'evidence_date_mismatch')
 def test_chronology(self):self.rejects(lambda d,b:d['newServingEpisodes'][0]['evidence'].reverse(),'non_chronological_evidence')
 def test_before_frame_required(self):self.rejects(lambda d,b:d['newServingEpisodes'][0].update(firstPlacement='18:05:00'),'before_after_context_missing')
 def test_unlinked_new_unit(self):self.rejects(lambda d,b:d['sceneDispositions'].pop(0),'unlinked_new_unit')
 def test_same_evidence_relabel(self):
  def change(d,b):u=copy.deepcopy(d['newServingEpisodes'][0]);u['id']='new-2';d['newServingEpisodes'].append(u)
  self.rejects(change,'same_evidence_claimed_as_new_unit')
if __name__=='__main__':unittest.main()
