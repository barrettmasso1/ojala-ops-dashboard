import unittest,tempfile,json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from browser_visual_relay import Browser,ORIGIN
class WindowTests(unittest.TestCase):
 def make(self,handles,url=ORIGIN+'/dashboard'):
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);p=Path(temp.name)/'session.json';p.write_text(json.dumps({'baseUrl':'http://127.0.0.1:4444','sessionId':'fixture','relayWindow':'old','dashboardWindow':'user'}));b=Browser(p);calls=[]
  def call(method,path,data=None,timeout=0):
   calls.append((method,path,data))
   if path=='/window/handles':return handles
   if path=='/url' and method=='GET':return url
   if path=='/window/new':return {'handle':'new'}
   return None
  b.call=call;return b,p,calls
 def test_valid_tab_is_reused(self):
  b,p,c=self.make(['old']);self.assertEqual(b.select_window(),'old');self.assertFalse(any(x[1]=='/window/new' for x in c))
 def test_closed_tab_is_recreated(self):
  b,p,c=self.make(['user']);self.assertEqual(b.select_window(),'new');self.assertEqual(json.loads(p.read_text())['relayWindow'],'new');self.assertEqual(json.loads(p.read_text())['dashboardWindow'],'user')
 def test_foreign_tab_is_never_used_for_data(self):
  b,p,c=self.make(['old'],'https://other.invalid');b.select_window();self.assertTrue(any(x[1]=='/window/new' for x in c));self.assertFalse(any(x[1]=='/window' and x[0]=='DELETE' for x in c))
 def test_closed_current_context_selects_survivor_before_new(self):
  b,p,c=self.make(['user']);b.select_window()
  switch=next(i for i,x in enumerate(c) if x[1]=='/window' and x[2]=={'handle':'user'})
  create=next(i for i,x in enumerate(c) if x[1]=='/window/new')
  self.assertLess(switch,create)
 def test_all_windows_closed_holds_without_inventing_session(self):
  b,p,c=self.make([])
  with self.assertRaisesRegex(ValueError,'no_surviving_browser_window'):b.select_window()
  self.assertFalse(any(x[1]=='/window/new' for x in c))
 def test_no_cookie_or_token_extraction(self):
  text=(Path(__file__).resolve().parents[1]/'browser_visual_relay.py').read_text();self.assertNotIn("'/cookie'",text);self.assertNotIn('document.cookie',text)
if __name__=='__main__':unittest.main()
