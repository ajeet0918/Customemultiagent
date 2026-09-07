"""Linux helper protocol tests. No desktop connection or input events."""
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('portal', Path(__file__).parents[1] / 'src/native/computer_portal.py')
portal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portal)

class FakeBus:
    def get_unique_name(self): return ':1.123'
    def signal_subscribe(self, *args): self.callback=args[-1]; return 1
    def signal_unsubscribe(self, subscription): self.unsubscribed=True

class ProtocolTest(unittest.TestCase):
    def test_signal_accepts_user_data(self):
        desktop=portal.Desktop.__new__(portal.Desktop)
        desktop.bus=FakeBus()
        def call(*args):
            desktop.bus.callback(None,None,None,None,None,portal.GLib.Variant('(ua{sv})',(0,{'session_handle':portal.GLib.Variant('s','/session/test')})),None)
        desktop.call=call
        self.assertEqual(desktop.request(portal.RD,'CreateSession','(a{sv})',[{}])['session_handle'],'/session/test')
        self.assertTrue(desktop.bus.unsubscribed)

    def test_coordinates_scale_to_logical_monitor(self):
        desktop=portal.Desktop.__new__(portal.Desktop)
        desktop.session='/session/test';desktop.closed=False;desktop.stream=5
        desktop.frame_size=(2000,1000);desktop.logical=(1000,500)
        events=[];desktop.notify=lambda *args:events.append(args)
        desktop.action({'action':'click','x':1000,'y':500})
        self.assertEqual(events[0],('NotifyPointerMotionAbsolute','udd',(5,500.0,250.0)))
        self.assertEqual(events[-1],('NotifyPointerButton','iu',(272,0)))
        with self.assertRaises(RuntimeError): desktop.action({'action':'move','x':2000,'y':0})

    def test_shortcuts_release_modifiers_in_reverse(self):
        desktop=portal.Desktop.__new__(portal.Desktop)
        desktop.session='/session/test';desktop.closed=False
        events=[];desktop.notify=lambda *args:events.append(args)
        desktop.action({'action':'key','key':'CTRL+l'})
        self.assertEqual([event[-1] for event in events],[(0xffe3,1),(ord('l'),1),(ord('l'),0),(0xffe3,0)])

if __name__=='__main__': unittest.main()
