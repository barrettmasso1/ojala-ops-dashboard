import unittest,tempfile,hashlib,io
from unittest.mock import patch
from pathlib import Path
from run_counter import native_observations,guard_source

class Connection:
 def __init__(self):self.closed=False
 def execute(self,*args):return []
 def close(self):self.closed=True
class LifecycleTests(unittest.TestCase):
 def test_native_read_connection_is_explicitly_closed(self):
  connection=Connection()
  with patch('run_counter.sqlite3.connect',return_value=connection):self.assertEqual(native_observations(Path('/tmp/test.sqlite3'),'2026-10-24'),[])
  self.assertTrue(connection.closed)
 def test_connection_closed_even_when_query_fails(self):
  connection=Connection()
  def fail(*_):raise RuntimeError('fixture_read_failure')
  connection.execute=fail
  with patch('run_counter.sqlite3.connect',return_value=connection):
   with self.assertRaises(RuntimeError):native_observations(Path('/tmp/test.sqlite3'),'2026-10-24')
  self.assertTrue(connection.closed)

class ActiveBindingTests(unittest.TestCase):
 def check(self,change=None):
  with tempfile.TemporaryDirectory() as d:
   model=Path(d)/'fixture.onnx';model.write_bytes(b'fixture-only-not-a-model')
   p={'detectorModelSha256':hashlib.sha256(model.read_bytes()).hexdigest(),'width':2304,'height':1296,'zones':{'handoff':[[.45,.55],[.609,.564],[.605,.685],[.453,.675]]}}
   cfg={'model':{'path':'/config/model_cache/ojala_cups_v4_640.onnx'},'cameras':{'handoff':{'detect':{'width':2304,'height':1296},'zones':{'handoff_zone':{'coordinates':'0.45,0.55,0.609,0.564,0.605,0.685,0.453,0.675'}}}}}
   if change:change(cfg,p)
   with patch('run_counter.read_json',return_value=cfg),patch('run_counter.urllib.request.urlopen',return_value=io.BytesIO(b'0.17.2-fixture')):return guard_source({'modelFile':str(model)},p)
 def test_current_path_and_hash_required(self):self.assertEqual(self.check(),'0.17.2-fixture')
 def test_active_path_change_blocks(self):
  with self.assertRaisesRegex(ValueError,'configuration_changed'):self.check(lambda c,p:c['model'].update(path='/config/other.onnx'))
 def test_active_geometry_change_blocks(self):
  with self.assertRaisesRegex(ValueError,'zone_changed'):self.check(lambda c,p:c['cameras']['handoff']['zones']['handoff_zone'].update(coordinates='0,0,1,0,1,1,0,1'))
 def test_model_content_hash_change_blocks(self):
  with self.assertRaisesRegex(ValueError,'model_changed'):self.check(lambda c,p:p.update(detectorModelSha256='f'*64))

if __name__=='__main__':unittest.main()
