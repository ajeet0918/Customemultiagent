"""User-consented Linux desktop session. JSON lines on stdin/stdout; no shell."""
import base64
import json
import os
import sys
import signal
import threading
import time
import uuid
import gi

gi.require_version('Gst', '1.0')
from gi.repository import Gio, GLib, Gst
Gst.init(None)
BUS = 'org.freedesktop.portal.Desktop'
PATH = '/org/freedesktop/portal/desktop'
RD = 'org.freedesktop.portal.RemoteDesktop'
SC = 'org.freedesktop.portal.ScreenCast'

class Desktop:
    def __init__(self):
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.session = None
        self.pipeline = None
        self.fd = None
        self.stream = None
        self.logical = None
        self.frame_size = None
        self.closed = False

    def call(self, interface, method, signature, values, path=PATH):
        return self.bus.call_sync(BUS, path, interface, method, GLib.Variant(signature, values), None, Gio.DBusCallFlags.NONE, 10000, None)

    def request(self, interface, method, signature, values):
        token = 'studio' + uuid.uuid4().hex
        values[-1]['handle_token'] = GLib.Variant('s', token)
        sender = self.bus.get_unique_name()[1:].replace('.', '_')
        request_path = '/org/freedesktop/portal/desktop/request/' + sender + '/' + token
        completed = threading.Event()
        result = []
        def response(_bus, _sender, _path, _interface, _signal, params, *_user_data):
            result.extend(params.unpack())
            completed.set()
        subscription = self.bus.signal_subscribe(BUS, 'org.freedesktop.portal.Request', 'Response', request_path, None, Gio.DBusSignalFlags.NONE, response)
        try:
            self.call(interface, method, signature, tuple(values))
            if not completed.wait(90):
                try: self.call('org.freedesktop.portal.Request', 'Close', '()', (), request_path)
                except Exception: pass
                raise RuntimeError('Desktop permission timed out. Try connecting again.')
            if result[0] != 0:
                raise RuntimeError('Desktop sharing was canceled or denied.')
            return result[1]
        finally:
            self.bus.signal_unsubscribe(subscription)

    def probe(self):
        for element in ['pipewiresrc', 'videoconvert', 'jpegenc', 'appsink']:
            if not Gst.ElementFactory.find(element):
                raise RuntimeError('Missing GStreamer plugin: ' + element)
        result = self.call('org.freedesktop.DBus.Properties', 'Get', '(ss)', (RD, 'AvailableDeviceTypes')).unpack()[0]
        if result & 3 != 3: raise RuntimeError('This desktop does not offer keyboard and pointer sharing.')
        return {'available': True, 'backend': 'Linux desktop portal'}

    def connect(self):
        self.probe()
        self.session = self.request(RD, 'CreateSession', '(a{sv})', [{'session_handle_token': GLib.Variant('s', 'studio'+uuid.uuid4().hex)}])['session_handle']
        self.bus.signal_subscribe(BUS, 'org.freedesktop.portal.Session', 'Closed', self.session, None, Gio.DBusSignalFlags.NONE, lambda *args: self.on_closed())
        self.request(RD, 'SelectDevices', '(oa{sv})', [self.session, {'types': GLib.Variant('u', 3)}])
        self.request(SC, 'SelectSources', '(oa{sv})', [self.session, {'types': GLib.Variant('u', 1), 'multiple': GLib.Variant('b', False), 'cursor_mode': GLib.Variant('u', 1)}])
        result = self.request(RD, 'Start', '(osa{sv})', [self.session, '', {}])
        if result.get('devices', 0) & 3 != 3: raise RuntimeError('Share both keyboard and pointer to enable computer control.')
        streams = result.get('streams', [])
        if len(streams) != 1: raise RuntimeError('Choose one monitor to share.')
        self.stream, properties = streams[0]
        self.logical = properties.get('logical_size') or properties.get('size')
        reply, fds = self.bus.call_with_unix_fd_list_sync(BUS, PATH, SC, 'OpenPipeWireRemote', GLib.Variant('(oa{sv})', (self.session, {})), GLib.VariantType.new('(h)'), Gio.DBusCallFlags.NONE, 10000, None, None)
        self.fd = fds.get(reply.unpack()[0])
        self.pipeline = Gst.parse_launch(f'pipewiresrc fd={self.fd} path={int(self.stream)} do-timestamp=true ! videoconvert ! jpegenc quality=75 ! appsink name=frame max-buffers=1 drop=true sync=false')
        self.pipeline.set_state(Gst.State.PLAYING)
        return {'connected': True, 'backend': 'Linux desktop portal'}

    def on_closed(self):
        self.closed = True
        print(json.dumps({'event': 'closed'}), flush=True)

    def screenshot(self):
        self.require()
        sink = self.pipeline.get_by_name('frame')
        # Discard a buffered old frame and obtain the next one.
        sink.emit('try-pull-sample', 0)
        sample = sink.emit('try-pull-sample', 5 * Gst.SECOND)
        if not sample: raise RuntimeError('No screen frame received. Check that screen sharing is still active.')
        structure = sample.get_caps().get_structure(0)
        w, h = structure.get_value('width'), structure.get_value('height')
        self.frame_size = (w, h)
        buffer = sample.get_buffer()
        data = buffer.extract_dup(0, buffer.get_size())
        if len(data) > 8_000_000: raise RuntimeError('Screen frame is too large.')
        return {'image': 'data:image/jpeg;base64,' + base64.b64encode(data).decode(), 'width': w, 'height': h}

    def require(self):
        if not self.session or self.closed: raise RuntimeError('Connect your computer before using desktop tools.')

    def notify(self, method, signature, args):
        self.require()
        self.call(RD, method, '(oa{sv}' + signature + ')', (self.session, {}, *args))

    def action(self, args):
        self.require()
        kind = args['action']
        if kind in ['click', 'move']:
            if not self.frame_size: raise RuntimeError('Take a screenshot before positioning the pointer.')
            x, y = float(args['x']), float(args['y'])
            w, h = self.frame_size
            if not 0 <= x < w or not 0 <= y < h: raise RuntimeError('Pointer coordinates are outside the shared screen.')
            lw, lh = self.logical or self.frame_size
            self.notify('NotifyPointerMotionAbsolute', 'udd', (self.stream, x*lw/w, y*lh/h))
            if kind == 'click':
                button = {'left': 272, 'right': 273, 'middle': 274}[args.get('button', 'left')]
                self.notify('NotifyPointerButton', 'iu', (button, 1))
                self.notify('NotifyPointerButton', 'iu', (button, 0))
        elif kind == 'scroll':
            self.notify('NotifyPointerAxisDiscrete', 'ui', (0, int(args['steps'])))
        elif kind == 'key':
            keys = {'Enter': 0xff0d, 'Tab': 0xff09, 'Escape': 0xff1b, 'Backspace': 0xff08, 'Delete': 0xffff, 'Space': 0x20, 'Up': 0xff52, 'Down': 0xff54, 'Left': 0xff51, 'Right': 0xff53, 'Home': 0xff50, 'End': 0xff57, 'PageUp': 0xff55, 'PageDown': 0xff56}
            modifiers = {'CTRL': 0xffe3, 'ALT': 0xffe9, 'SHIFT': 0xffe1, 'SUPER': 0xffeb}
            parts = args['key'].split('+')
            last = parts[-1]
            codes = [modifiers[p.upper()] for p in parts[:-1]] + [keys[last] if last in keys else ord(last.lower())]
            pressed = []
            try:
                for code in codes:
                    self.notify('NotifyKeyboardKeysym', 'iu', (code, 1)); pressed.append(code)
            finally:
                for code in reversed(pressed): self.notify('NotifyKeyboardKeysym', 'iu', (code, 0))
        elif kind == 'type':
            for char in args['text']:
                code = 0xff0d if char == '\n' else 0xff09 if char == '\t' else ord(char) if ord(char) <= 255 else 0x01000000 | ord(char)
                self.notify('NotifyKeyboardKeysym', 'iu', (code, 1))
                self.notify('NotifyKeyboardKeysym', 'iu', (code, 0))
        else: raise RuntimeError('Unsupported desktop action.')
        return {'performed': kind}

    def close(self):
        if self.pipeline: self.pipeline.set_state(Gst.State.NULL)
        if self.session and not self.closed:
            try: self.call('org.freedesktop.portal.Session', 'Close', '()', (), self.session)
            except Exception: pass
        if self.fd is not None: os.close(self.fd)
        self.closed = True

def main():
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    desktop = Desktop()
    loop = GLib.MainLoop()
    threading.Thread(target=loop.run, daemon=True).start()
    try:
        for line in sys.stdin:
            request = {}
            try:
                if len(line) > 16000: raise RuntimeError('Request too large.')
                request = json.loads(line)
                method = request['method']
                if method == 'probe': result = desktop.probe()
                elif method == 'connect': result = desktop.connect()
                elif method == 'screenshot': result = desktop.screenshot()
                elif method == 'action': result = desktop.action(request['args'])
                else: raise RuntimeError('Unknown desktop operation.')
                print(json.dumps({'id': request.get('id'), 'result': result}), flush=True)
            except Exception as error:
                print(json.dumps({'id': request.get('id'), 'error': str(error)[:700]}), flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        desktop.close(); loop.quit()

if __name__ == '__main__': main()
