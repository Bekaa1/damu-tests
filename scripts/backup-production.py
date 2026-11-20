"""AssessFlow database backups with pilot-data expiry. Run on the VPS.

create NAME: pg_dump + verified archive + expiry manifest (root access only).
expire: remove ONLY explicitly registered archives at their expiry, no recursive delete.
The earliest pilot participant deadline limits the entire backup, including
copies made after that participant joined. Restore only unexpired archives;
start the API retention sweep before opening access after any restore.
"""
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path('/opt/assessflow/backups')

def now():
    return dt.datetime.now(dt.timezone.utc)

def create(name):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', name):
        raise ValueError('Invalid backup directory name')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    target = ROOT / name
    target.mkdir(mode=0o700)  # never overwrite an existing archive
    # Read the deadline before the dump. A participant registered concurrently
    # will have a later deadline; 7 days is an additional upper bound for backups.
    query = """SELECT min(m.\"createdAt\" + interval '3 months') AT TIME ZONE 'UTC'
      FROM memberships m JOIN organizations o ON o.id=m.\"organizationId\"
      JOIN users u ON u.id=m.\"userId\"
      WHERE o.purpose='pilot' AND m.role='employee' AND NOT u.\"platformAdmin\";"""
    deadline = subprocess.check_output(['docker','exec','assessflow-postgres-1','psql','-U','assessflow','-d','assessflow','-Atc',query],text=True).strip()
    expiry = now() + dt.timedelta(days=7)
    if deadline:
        expiry = min(expiry,dt.datetime.fromisoformat(deadline).replace(tzinfo=dt.timezone.utc))
    if expiry <= now():
        raise RuntimeError('Expired pilot data remain. Run retention before backing up.')
    # Write expiry first: even a failed/incomplete dump remains covered by cleanup.
    (target/'retention.json').write_text(json.dumps({'expiresAt':expiry.isoformat(),'files':['database.dump','database-list.txt'],'policy':'seven_days_or_earliest_pilot_deadline'}))
    with (target/'database.dump').open('wb') as stream:
        subprocess.run(['docker','exec','assessflow-postgres-1','pg_dump','-U','assessflow','-Fc','assessflow'],stdout=stream,check=True)
    with (target/'database.dump').open('rb') as source, (target/'database-list.txt').open('wb') as listing:
        subprocess.run(['docker','exec','-i','assessflow-postgres-1','pg_restore','--list'],stdin=source,stdout=listing,check=True)
    print(str(target))

def expire():
    count = 0
    if not ROOT.exists():
        return
    root = ROOT.resolve()
    for manifest in ROOT.glob('*/retention.json'):
        if manifest.is_symlink() or manifest.parent.is_symlink() or manifest.resolve().parent.parent != root:
            raise RuntimeError('Unexpected backup path')
        data = json.loads(manifest.read_text())
        if dt.datetime.fromisoformat(data['expiresAt']) > now():
            continue
        for name in data['files']:
            if name not in ['database.dump','database-list.txt']:
                raise RuntimeError('Unexpected backup file')
            target = manifest.parent/name
            if target.is_symlink() or target.resolve().parent != manifest.parent.resolve():
                raise RuntimeError('Unexpected backup target')
            target.unlink(missing_ok=True)
        count += 1
    print(json.dumps({'expiredArchives':count}))

if __name__ == '__main__':
    os.umask(0o077)
    if len(sys.argv)==3 and sys.argv[1]=='create':
        create(sys.argv[2])
    elif sys.argv[1:]==['expire']:
        expire()
    else:
        raise SystemExit('Usage: backup-production.py create NAME | expire')
