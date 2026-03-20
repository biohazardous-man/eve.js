'use strict';

/*
 * Native TiDi probe for EVE's blue.dll.
 *
 * This agent intentionally avoids the earlier xref-scanning / delayed Python
 * probe path and instead hooks the exact RVAs recovered from static reversing.
 * The goal is to capture the real native TiDi BlueNet traffic:
 *   - Init   (kind 0x001658A0)
 *   - Event  (kind 0x001658B7)
 *   - Detach (kind 0x009E3144)
 *
 * The wire payload bodies are compactly marshalled native payloads, so we log:
 *   - the exact payload bytes passed into BlueNet send / recv
 *   - the higher-level semantic fields from the native send helpers
 */

const ENABLE_PYTHON_PROBE = __ENABLE_PYTHON_PROBE__;

const TIDI_KINDS = {
  0x001658a0: 'Init',
  0x001658b7: 'Event',
  0x009e3144: 'Detach',
};

const OFFSETS = {
  initSend: 0x19f630,
  detachSend: 0x19f8e9,
  eventSend: 0x19fab0,
  recv: 0x19fec0,
  tickAdjust: 0x1a0360,
  sendSingle: 0x18b120,
  sendMulti: 0x18b230,
};

function emit(payload) {
  send(payload);
}

function status(message) {
  emit({ type: 'status', message: message });
}

function kindName(kind) {
  return TIDI_KINDS[kind] || 'Unknown';
}

function kindHex(kind) {
  return '0x' + (kind >>> 0).toString(16).padStart(8, '0');
}

function hexBytes(ptrValue, length, maxLength) {
  if (ptrValue.isNull()) {
    return '';
  }

  const size = Math.max(0, Math.min(length >>> 0, maxLength >>> 0));
  const bytes = ptrValue.readByteArray(size);
  if (bytes === null) {
    return '';
  }

  const view = new Uint8Array(bytes);
  const out = [];
  for (let i = 0; i < view.length; i++) {
    out.push(view[i].toString(16).padStart(2, '0'));
  }
  return out.join(' ');
}

function readU64String(ptrValue) {
  return ptrValue.readU64().toString();
}

function readDouble(ptrValue) {
  return Number(ptrValue.readDouble());
}

function emitSemantic(label, data) {
  emit({
    type: 'tidi-semantic',
    label: label,
    data: data,
  });
}

function emitWire(direction, fields) {
  const payload = Object.assign({ type: 'tidi-wire', direction: direction }, fields);
  emit(payload);
}

function tryPythonProbe(blueDll, pyDllName) {
  if (!ENABLE_PYTHON_PROBE) {
    status('Python probe disabled; native TiDi hooks only.');
    return;
  }

  const pyRunPtr = Module.findExportByName(pyDllName, 'PyRun_SimpleString');
  const gilEnsurePtr = Module.findExportByName(pyDllName, 'PyGILState_Ensure');
  const gilReleasePtr = Module.findExportByName(pyDllName, 'PyGILState_Release');

  if (!pyRunPtr || !gilEnsurePtr || !gilReleasePtr) {
    emit({
      type: 'python-probe',
      status: 'unavailable',
      error: 'Missing Python C API exports',
    });
    return;
  }

  try {
    const gilEnsure = new NativeFunction(gilEnsurePtr, 'int', []);
    const gilRelease = new NativeFunction(gilReleasePtr, 'void', ['int']);
    const pyRun = new NativeFunction(pyRunPtr, 'int', ['pointer']);

    const code = [
      'import json',
      'import traceback',
      'out = {}',
      'try:',
      '    import blue',
      '    props = {}',
      '    for name in ("simDilation", "desiredSimDilation", "minSimDilation", "maxSimDilation"):',
      '        try:',
      '            value = getattr(blue.os, name)',
      '            props[name] = {"value": value, "type": type(value).__name__}',
      '        except Exception as e:',
      '            props[name] = {"error": str(e)}',
      '    out["props"] = props',
      'except Exception:',
      '    out["fatal"] = traceback.format_exc()',
      'open(r"C:\\\\Users\\\\John\\\\Documents\\\\Testing\\\\EvEJS\\\\client\\\\tidi_probe_py.json", "w").write(json.dumps(out, indent=2))',
    ].join('\n');

    const state = gilEnsure();
    try {
      const rc = pyRun(Memory.allocUtf8String(code));
      emit({ type: 'python-probe', status: 'ran', returnCode: rc });
    } finally {
      gilRelease(state);
    }
  } catch (err) {
    emit({
      type: 'python-probe',
      status: 'failed',
      error: String(err),
    });
  }
}

function installHooks(blueDll) {
  const base = blueDll.base;

  const recvPtr = base.add(OFFSETS.recv);
  const initSendPtr = base.add(OFFSETS.initSend);
  const detachSendPtr = base.add(OFFSETS.detachSend);
  const eventSendPtr = base.add(OFFSETS.eventSend);
  const tickAdjustPtr = base.add(OFFSETS.tickAdjust);
  const sendSinglePtr = base.add(OFFSETS.sendSingle);
  const sendMultiPtr = base.add(OFFSETS.sendMulti);

  status('Installing direct blue.dll TiDi hooks');

  Interceptor.attach(recvPtr, {
    onEnter(args) {
      const kind = args[2].toInt32();
      const payloadPtr = args[3];
      const payloadLength = this.context.rsp.add(0x28).readU32();
      emitWire('recv', {
        hook: 'recv',
        kind: kind,
        kindHex: kindHex(kind),
        kindName: kindName(kind),
        masterID: args[1].toString(),
        payloadLength: payloadLength,
        payloadHex: hexBytes(payloadPtr, payloadLength, 64),
      });
    },
  });

  Interceptor.attach(initSendPtr, {
    onEnter(args) {
      const thisPtr = args[0];
      emitSemantic('InitSend', {
        clientID: args[1].toString(),
        baseTime: readU64String(thisPtr.add(0x18)),
        factor: readDouble(thisPtr.add(0x20)),
        eventTime: readU64String(thisPtr.add(0x10)),
      });
    },
  });

  Interceptor.attach(eventSendPtr, {
    onEnter(args) {
      const eventPtr = args[1];
      emitSemantic('EventSend', {
        baseTime: readU64String(eventPtr),
        eventTime: readU64String(eventPtr.add(0x8)),
        factor: readDouble(eventPtr.add(0x10)),
      });
    },
  });

  Interceptor.attach(detachSendPtr, {
    onEnter(args) {
      emitSemantic('DetachSend', {
        note: 'Detach sender wrapper entered',
      });
    },
  });

  Interceptor.attach(tickAdjustPtr, {
    onEnter(args) {
      const thisPtr = args[0];
      emitSemantic('TickAdjust', {
        simEnabled: thisPtr.add(0x7e9).readU8(),
        currentFactor: readDouble(thisPtr.add(0x20)),
        minFactor: readDouble(thisPtr.add(0x7f0)),
        maxFactor: readDouble(thisPtr.add(0x7f8)),
      });
    },
  });

  Interceptor.attach(sendSinglePtr, {
    onEnter(args) {
      const kind = args[2].toInt32();
      if (!TIDI_KINDS[kind]) {
        return;
      }

      const payloadPtr = args[3];
      const payloadLength = this.context.rsp.add(0x28).readU32();
      const flags = this.context.rsp.add(0x30).readU32();

      emitWire('send', {
        hook: 'sendSingle',
        kind: kind,
        kindHex: kindHex(kind),
        kindName: kindName(kind),
        clientID: args[1].toString(),
        payloadLength: payloadLength,
        flags: flags,
        payloadHex: hexBytes(payloadPtr, payloadLength, 64),
      });
    },
  });

  Interceptor.attach(sendMultiPtr, {
    onEnter(args) {
      const kind = args[3].toInt32();
      if (!TIDI_KINDS[kind]) {
        return;
      }

      const payloadPtr = this.context.rsp.add(0x28).readPointer();
      const payloadLength = this.context.rsp.add(0x30).readU32();
      const flags = this.context.rsp.add(0x38).readU32();

      emitWire('send', {
        hook: 'sendMulti',
        kind: kind,
        kindHex: kindHex(kind),
        kindName: kindName(kind),
        clientCount: args[2].toInt32(),
        payloadLength: payloadLength,
        flags: flags,
        payloadHex: hexBytes(payloadPtr, payloadLength, 64),
      });
    },
  });
}

function main() {
  const blueDll = Process.findModuleByName('blue.dll');
  if (!blueDll) {
    emit({ type: 'fatal', error: 'blue.dll not found' });
    return;
  }

  let pyDllName = null;
  Process.enumerateModules().forEach(function (mod) {
    if (/^python\\d+\\.dll$/i.test(mod.name)) {
      pyDllName = mod.name;
    }
  });

  emit({
    type: 'module-info',
    blueBase: blueDll.base.toString(),
    blueSize: '0x' + blueDll.size.toString(16),
    pythonDll: pyDllName,
  });

  installHooks(blueDll);
  tryPythonProbe(blueDll, pyDllName);

  status('Native TiDi probe armed. Use /tidi in-game to capture Init/Event/Detach.');
}

try {
  main();
} catch (err) {
  emit({
    type: 'fatal',
    error: String(err),
    stack: err.stack || null,
  });
}
