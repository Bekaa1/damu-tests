import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import unittest

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

if __name__ == '__main__':
    unittest.main()
