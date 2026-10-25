import unittest
from unittest.mock import patch
from pathlib import Path
from run_counter import native_observations

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
if __name__=='__main__':unittest.main()
