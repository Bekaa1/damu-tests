import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup', pathlib.Path(__file__).parents[1]/'scripts'/'backup-production.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class BackupRetention(unittest.TestCase):
    def test_only_expired_registered_archives_are_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            backup.ROOT = pathlib.Path(temp)
            for name, offset in [('expired',-1),('fresh',1),('unregistered',0)]:
                folder=backup.ROOT/name
                folder.mkdir()
                (folder/'database.dump').write_text('synthetic data')
                (folder/'notes.txt').write_text('keep')
                if offset:
                    (folder/'retention.json').write_text(json.dumps({'expiresAt':(backup.now()+dt.timedelta(days=offset)).isoformat(),'files':['database.dump','database-list.txt']}))
            backup.expire()
            self.assertFalse((backup.ROOT/'expired'/'database.dump').exists())
            self.assertTrue((backup.ROOT/'expired'/'notes.txt').exists())
            self.assertTrue((backup.ROOT/'fresh'/'database.dump').exists())
            self.assertTrue((backup.ROOT/'unregistered'/'database.dump').exists())
            backup.expire()  # already deleted is safe

    def test_path_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            backup.ROOT=pathlib.Path(temp)
            folder=backup.ROOT/'bad'
            folder.mkdir()
            (backup.ROOT/'keep.dump').write_text('keep')
            (folder/'retention.json').write_text(json.dumps({'expiresAt':(backup.now()-dt.timedelta(days=1)).isoformat(),'files':['../keep.dump']}))
            with self.assertRaises(RuntimeError):
                backup.expire()
            self.assertTrue((backup.ROOT/'keep.dump').exists())

    def test_creation_caps_archive_at_every_employee_deadline(self):
        fixed = dt.datetime(2027, 2, 27, 12, tzinfo=dt.timezone.utc)
        for deadline, expected in [('', fixed + dt.timedelta(days=7)),
                                   ('2027-02-28 10:15:30.123', dt.datetime(2027, 2, 28, 10, 15, 30, 123000, tzinfo=dt.timezone.utc))]:
            with self.subTest(deadline=deadline), tempfile.TemporaryDirectory() as temp:
                backup.ROOT = pathlib.Path(temp)
                with patch.object(backup, 'now', return_value=fixed), patch.object(backup.subprocess, 'check_output', return_value=deadline) as query, patch.object(backup.subprocess, 'run'):
                    backup.create('synthetic-test')
                sql = query.call_args.args[0][-1]
                self.assertIn("m.role='employee'", sql)
                self.assertIn('NOT u."platformAdmin"', sql)
                self.assertNotIn("o.purpose='pilot'", sql)
                self.assertIn("SET TIME ZONE 'UTC'", sql)
                manifest = json.loads((backup.ROOT/'synthetic-test'/'retention.json').read_text())
                self.assertEqual(dt.datetime.fromisoformat(manifest['expiresAt']), expected)
                self.assertEqual(manifest['policy'], 'seven_days_or_earliest_participant_deadline')

    def test_expired_employee_blocks_dump_before_any_database_archive(self):
        fixed = dt.datetime(2027, 2, 28, 12, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as temp:
            backup.ROOT = pathlib.Path(temp)
            with patch.object(backup, 'now', return_value=fixed), patch.object(backup.subprocess, 'check_output', return_value='2027-02-28 12:00:00'), patch.object(backup.subprocess, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'Expired participant data'):
                    backup.create('expired')
                run.assert_not_called()
                self.assertFalse((backup.ROOT/'expired'/'database.dump').exists())

    def test_symlink_target_is_rejected_without_touching_outside_file(self):
        with tempfile.TemporaryDirectory() as temp:
            backup.ROOT = pathlib.Path(temp)/'backups'
            folder = backup.ROOT/'bad'
            folder.mkdir(parents=True)
            outside = pathlib.Path(temp)/'outside.dump'
            outside.write_text('keep')
            (folder/'database.dump').symlink_to(outside)
            (folder/'retention.json').write_text(json.dumps({'expiresAt':(backup.now()-dt.timedelta(days=1)).isoformat(),'files':['database.dump']}))
            with self.assertRaises(RuntimeError):
                backup.expire()
            self.assertEqual(outside.read_text(), 'keep')

if __name__ == '__main__':
    unittest.main()
