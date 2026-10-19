import importlib.util
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('tooltips', Path(__file__).resolve().parents[1] / 'scripts/sync-tooltips.py')
tooltips = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tooltips)


class TooltipTextTests(unittest.TestCase):
    def test_clean_strips_markup_icons_and_placeholders(self):
        raw = "Gain %i:scaleAS% @AttackSpeed*100@% <speed>Attack Speed</speed>.<br><br><flavorText>Bang!</flavorText><img src=x onerror=1>&amp; more"
        self.assertEqual(tooltips.clean(raw), 'Gain X% Attack Speed.\n\n& more')

    def test_clean_resolves_references_and_drops_unknown_ones(self):
        table = {'item_keyword_onhit': '<keyword>On-Hit</keyword>'}
        self.assertEqual(tooltips.clean('Apply {{ Item_Keyword_OnHit }} effects{{ Missing@f1@ }}.', table), 'Apply On-Hit effects.')

    def test_augment_text_prefers_summaries_over_tooltips(self):
        table = {
            'kiwi_aram_killsecured_tooltip': 'Gain @MovementSpeed*100@% speed',
            'kiwi_aram_killsecured_summary': 'Gain <speed>Movement Speed</speed> towards enemies.',
        }
        self.assertEqual(tooltips.augment_text('ARAM_KillSecured', table), 'Gain Movement Speed towards enemies.')
        self.assertIsNone(tooltips.augment_text('Unknown', table))

    def test_item_records_keep_name_text_and_price(self):
        records = tooltips.item_records([
            {'id': 3111, 'name': 'Mercury', 'description': '<stats><attention>20</attention> MR</stats>', 'priceTotal': 1250},
            {'id': 0, 'name': 'Bad'},
            {'id': 5, 'name': ''},
        ])
        self.assertEqual(records, {'3111': {'name': 'Mercury', 'text': '20 MR', 'price': 1250}})


if __name__ == '__main__':
    unittest.main()
