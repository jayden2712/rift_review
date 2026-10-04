import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('wiki_spells',Path(__file__).resolve().parents[1]/'scripts/wiki-spell-icons.py')
wiki=importlib.util.module_from_spec(spec);spec.loader.exec_module(wiki)

class SpellTests(unittest.TestCase):
    def test_current_image_is_not_replaced_by_history_or_keywords(self):
        p=wiki.SpellImages();p.feed('''<img alt="An icon representing Flash" src="/en-us/images/thumb/Flash.png/20px-Flash.png?new"><img alt="An icon representing Flash" src="/en-us/images/Flash_old.png?old"><img alt="An icon representing the keyword Cleanse" src="/en-us/images/Champion_ability.png?a">''')
        self.assertEqual(wiki.lookup(p.icons,'4','Flash')['url'],'https://wiki.leagueoflegends.com/en-us/images/Flash.png?new')
        self.assertIsNone(wiki.lookup(p.icons,'1','Cleanse'))
    def test_special_names_are_resolved_from_page_evidence(self):
        p=wiki.SpellImages();p.feed('''<img alt="An icon representing Flee (Arena)" src="/en-us/images/Flee_augment.png?a"><img src="/en-us/images/Placeholder_and_Attack-Smite.png?b">''')
        self.assertTrue(wiki.lookup(p.icons,'2201','Flee')['url'].endswith('?a'))
        self.assertTrue(wiki.lookup(p.icons,'55','Placeholder and Attack-Smite')['url'].endswith('?b'))
        self.assertIsNone(wiki.lookup(p.icons,'54','Placeholder'))
    def test_blocked_or_untrusted_pages_fail_closed(self):
        with self.assertRaises(ValueError):wiki.spell_index('<html>blocked</html>')
        with self.assertRaises(ValueError):wiki.SpellImages().feed('<img alt="An icon representing Flash" src="https://evil.test/en-us/images/Flash.png">')

if __name__=='__main__':unittest.main()
