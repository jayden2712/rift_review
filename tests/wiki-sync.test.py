"""Regression tests for refreshing existing icons and passing fresh metadata."""
import importlib.util
from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('asset_sync', Path(__file__).resolve().parents[1] / 'scripts/sync-game-assets.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class SyncTests(unittest.TestCase):
    def test_existing_spell_is_replaced_and_duplicate_urls_are_downloaded_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'public/spells').mkdir(parents=True)
            target = root / 'public/spells/4.png'
            target.write_bytes(b'old image')
            records = [{'kind': 'spell', 'id': identifier, 'url': 'https://example.test/Flash.png'} for identifier in ['4', '2202']]
            with patch.object(sync, 'ROOT', root), patch.object(sync, 'fetch_image', return_value=b'new image') as fetch:
                completed = sync.save_images(records)
            fetch.assert_called_once()
            self.assertEqual(target.read_bytes(), b'new image')
            self.assertEqual((target.parent / '2202.png').read_bytes(), b'new image')
            self.assertEqual(completed[0]['sha256'], completed[1]['sha256'])
            self.assertNotIn('sha256', records[0])

    def test_failed_download_does_not_replace_existing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'public/spells').mkdir(parents=True)
            target = root / 'public/spells/4.png'
            target.write_bytes(b'old image')
            with patch.object(sync, 'ROOT', root), patch.object(sync, 'fetch_image', side_effect=ValueError('Invalid image')):
                with self.assertRaises(ValueError):
                    sync.save_images([{'kind': 'spell', 'id': '4', 'url': 'https://example.test/Flash.png'}])
            self.assertEqual(target.read_bytes(), b'old image')

    def test_auxiliary_importer_receives_new_rune_names_before_module_generation(self):
        observed = []
        def run(command, check):
            self.assertTrue(check)
            if '--rune-names' in command:
                observed.append(json.loads(Path(command[-1]).read_text()))
        with patch.object(sync.subprocess, 'run', side_effect=run):
            sync.sync_auxiliary([{'kind': 'rune', 'id': '99999', 'english': 'New Rune'},
                                 {'kind': 'rank', 'id': 'EMERALD', 'english': 'Emerald'}])
        self.assertEqual(observed, [{'99999': 'New Rune'}])


if __name__ == '__main__':
    unittest.main()
