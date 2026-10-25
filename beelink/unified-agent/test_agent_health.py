import unittest,copy
from agent_health import summarize,fresh,UNITS
NOW=1792861200;DAY='2026-10-24'
from datetime import datetime,timezone
def at(delta=0):return datetime.fromtimestamp(NOW+delta,timezone.utc).isoformat()
def baseline():
 r={k:{'checkedAt':at(),'status':'running'} for k in ['capture','collector','ledgerSync','photoSync','calibration','archive']}
 r['archive'].update(status='ok',archive_bytes=10,max_archive_bytes=100)
 r['capture'].update(operating_hours=True,process_fps=5,max_temperature_c=65)
 r['ledgerSync']['results']=[{'businessDate':DAY,'status':'acknowledged'}]
 r['photoSync']['photoStateCounts']={'acknowledged':8}
 r['photoSync']['automaticValidation']={'status':'checked','states':{'verified':8}}
 r['calibration']['supportedCategories']=['mediano','not_cup']
 return r,{u:'active' for u in UNITS}
class HealthTests(unittest.TestCase):
 def report(self,records,services):return summarize(records,services,NOW,DAY,1,'device-test')
 def test_running_is_not_commercial_certification(self):
  r,s=baseline();o=self.report(r,s);self.assertEqual(o['status'],'running');self.assertFalse(o['commercialAcceptanceComplete']);self.assertFalse(o['uniquePhysicalCountValidated'])
 def test_missing_photos_never_green(self):
  r,s=baseline();r.pop('photoSync');self.assertIn('photoSync_missing_or_stale',self.report(r,s)['issues'])
 def test_old_photo_health_never_green(self):
  r,s=baseline();r['photoSync']['checkedAt']=at(-160);self.assertEqual(self.report(r,s)['status'],'attention_required')
 def test_yesterday_ack_is_not_today(self):
  r,s=baseline();r['ledgerSync']['results'][0]['businessDate']='2026-10-23';self.assertFalse(self.report(r,s)['todayLedgerAcknowledged'])
 def test_unknown_receipt_not_acknowledged(self):
  r,s=baseline();r['ledgerSync']['results'][0]['status']='delivery_unknown';self.assertIn('ledger_reception_not_acknowledged',self.report(r,s)['issues'])
 def test_temperature_not_hidden_by_fps(self):
  r,s=baseline();r['capture']['max_temperature_c']=88;self.assertIn('physical_cooling_attention',self.report(r,s)['issues'])
 def test_degraded_processing_reported(self):
  r,s=baseline();r['capture']['process_fps']=2.8;self.assertIn('camera_processing_degraded',self.report(r,s)['issues'])
 def test_outside_schedule_not_a_processing_failure(self):
  r,s=baseline();r['capture'].update(operating_hours=False,process_fps=0);self.assertNotIn('camera_processing_degraded',self.report(r,s)['issues'])
 def test_manual_session_treated_as_active(self):
  r,s=baseline();r['capture'].update(operating_hours=False,manual_session_outside_schedule=True,process_fps=0);self.assertIn('camera_processing_degraded',self.report(r,s)['issues'])
 def test_auth_hold_visible(self):
  r,s=baseline();r['photoSync']['status']='authorization_hold';self.assertIn('photo_transport_authorization_hold',self.report(r,s)['issues'])
 def test_blocked_item_visible(self):
  r,s=baseline();r['photoSync']['photoStateCounts']['blocked']=1;self.assertIn('photo_items_blocked',self.report(r,s)['issues'])
 def test_disabled_service_visible(self):
  r,s=baseline();s[UNITS[3]]='inactive';self.assertIn('service_not_active:'+UNITS[3],self.report(r,s)['issues'])
 def test_only_validated_sizes_listed(self):
  r,s=baseline();o=self.report(r,s);self.assertEqual(o['locallySupportedSizes'],['mediano']);self.assertEqual(o['sizesNotYetValidated'],['chico','pint','litro'])
 def test_evidence_rejection_not_hidden(self):
  r,s=baseline();r['collector']['invalidEvidence']=[{'reason':'capture_after_event_end'}];self.assertIn('capture_evidence_rejected',self.report(r,s)['issues'])
 def test_timezone_free_or_future_timestamp_not_fresh(self):
  self.assertFalse(fresh({'checkedAt':'2026-10-24T12:00:00'},NOW,100));self.assertFalse(fresh({'checkedAt':at(100)},NOW,100))
 def test_backlog_does_not_count_exclusions(self):
  r,s=baseline();r['photoSync']['photoStateCounts']={'queued':3,'delivery_unknown':2,'excluded':8};self.assertEqual(self.report(r,s)['photoBacklog'],5)
 def test_no_mutation(self):
  r,s=baseline();old=copy.deepcopy(r);self.report(r,s);self.assertEqual(r,old)
 def test_archive_pause_cannot_be_green(self):
  r,s=baseline();r['archive']['status']='paused_storage_limit';self.assertIn('recording_archive_not_healthy',self.report(r,s)['issues'])
 def test_archive_quota_warns_before_stop(self):
  r,s=baseline();r['archive']['archive_bytes']=96;self.assertIn('recording_archive_quota_nearly_full',self.report(r,s)['issues'])
 def test_archive_timestamp_format_is_supported(self):
  r,s=baseline();r['archive'].pop('checkedAt');r['archive']['checked_at_utc']=at();self.assertNotIn('archive_missing_or_stale',self.report(r,s)['issues'])
 def test_receiving_photo_without_automatic_validation_is_not_green(self):
  r,s=baseline();r['photoSync'].pop('automaticValidation');self.assertIn('photo_automatic_validation_missing',self.report(r,s)['issues'])
 def test_automatic_approval_block_is_visible(self):
  r,s=baseline();r['photoSync']['automaticValidation']['states']={'blocked':1};self.assertIn('photo_automatic_validation_blocked',self.report(r,s)['issues'])
 def test_disabled_auto_validation_is_visible(self):
  r,s=baseline();r['photoSync']['automaticValidation']['status']='disabled';self.assertIn('photo_automatic_validation_disabled',self.report(r,s)['issues'])
 def test_unknown_auto_receipt_is_not_success(self):
  r,s=baseline();r['photoSync']['automaticValidation']['states']={'unknown':1};self.assertIn('photo_automatic_validation_readback_pending',self.report(r,s)['issues'])
 def test_human_decisions_are_not_counted_as_machine_validations(self):
  r,s=baseline();r['photoSync']['automaticValidation']['states']={'verified':2,'preserved_manual':3};self.assertEqual(self.report(r,s)['photoAutomaticValidation'],{'verified':2,'preserved_manual':3})

 def test_optional_directional_missing_health_not_green(self):
  r,s=baseline();r['directionalCounter']=None;r['directionalFrames']=None;o=self.report(r,s);self.assertIn('directionalCounter_missing_or_stale',o['issues'])
 def test_directional_disabled_transport_not_received(self):
  r,s=baseline();r['directionalCounter']={'checkedAt':at(),'status':'observing','businessDate':DAY,'transport':{'status':'disabled'}};r['directionalFrames']={'checkedAt':at(),'status':'receiving'};self.assertIn('directional_counter_not_received',self.report(r,s)['issues'])
 def test_directional_estimate_does_not_certify_full_day(self):
  r,s=baseline();r['directionalCounter']={'checkedAt':at(),'status':'observing','businessDate':DAY,'estimatedHandoffs':3,'geometryCalibration':'provisional_visual_orientation','transport':{'status':'acknowledged'}};r['directionalFrames']={'checkedAt':at(),'status':'receiving'};o=self.report(r,s);self.assertFalse(o['uniquePhysicalCountValidated']);self.assertEqual(o['directionalCounter']['estimatedHandoffs'],3)
 def test_directional_not_required_if_not_configured(self):
  r,s=baseline();self.assertFalse(any('directional' in x for x in self.report(r,s)['issues']))
if __name__=='__main__':unittest.main()
