#!/usr/bin/env python3
"""Read-only snapshot for comparing a disconnected, stable, and blinking setup."""
import datetime, json, pathlib, subprocess, sys
destination = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'artifacts/hardware.json')
destination.parent.mkdir(parents=True, exist_ok=True)
report = {'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'note': 'Local report includes device serials. No voltage, cable-integrity or panel-blackout sensor is available.'}
for name, args in {
    'displays': ['system_profiler','SPDisplaysDataType','-json'],
    'usb': ['system_profiler','SPUSBDataType','-json'],
    'power': ['pmset','-g','batt'],
}.items():
    try:
        result = subprocess.run(args,capture_output=True,text=True,timeout=30,check=True)
        report[name] = json.loads(result.stdout) if name != 'power' else result.stdout.strip()
    except (subprocess.SubprocessError, ValueError) as error:
        report[name] = {'error': str(error)}
destination.write_text(json.dumps(report,indent=2)+'\n')
print(f'Saved read-only connection snapshot to {destination.resolve()}')
