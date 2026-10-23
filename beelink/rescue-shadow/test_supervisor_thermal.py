import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("launch_shadow",Path(__file__).with_name("launch_shadow.py"));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ThermalTests(unittest.TestCase):
 def test_high_temperature_holds(self):self.assertTrue(m.thermal_hold(90,False))
 def test_threshold_holds(self):self.assertTrue(m.thermal_hold(85,False))
 def test_cool_unheld_runs(self):self.assertFalse(m.thermal_hold(84,False))
 def test_hysteresis_holds(self):self.assertTrue(m.thermal_hold(80,True))
 def test_resume_boundary(self):self.assertFalse(m.thermal_hold(78,True))
 def test_cool_runs(self):self.assertFalse(m.thermal_hold(77,False))
 def test_unknown_temperature_holds(self):self.assertTrue(m.thermal_hold(None,False))
 def test_unknown_held_stays_held(self):self.assertTrue(m.thermal_hold(None,True))
if __name__=="__main__":unittest.main()
