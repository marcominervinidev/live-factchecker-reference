"""Issue #25 (T1), review round 2: further rules of scripts/check-contract-change.sh beyond the frozen nine
scenarios in test_check_contract_change.py (whose throwaway-repository helpers this file reuses unchanged).

- A new schema is not a schemaVersion bump: a changed shared building block still needs a bump of an existing one.
- The ADR a contract commit names must be added or changed in the change set; an old ADR does not carry it.
- Paths are read NUL-separated; an unusual path under packages/contracts fails the check, in any locale.
- A renamed schema is compared with its old path: a changed rename without a higher schemaVersion fails.

Stdlib only. Run: python3 -I -m unittest discover -s tools/tests -p test_check_contract_change_extra.py
"""
import unittest

import test_check_contract_change as frozen


class ContractCheckExtra(unittest.TestCase):
    C = frozen.ContractCheck  # helpers only; the frozen tests themselves run from their own file
    setUp = C.setUp
    git, write, commit, check = C.git, C.write, C.commit, C.check
    assertPasses, assertFails, adr, contract_commit = C.assertPasses, C.assertFails, C.adr, C.contract_commit
    del C

    def new_schema(self, path="packages/contracts/src/turn.ts"):
        self.write(path, frozen.SCHEMA.format(version=1, max_text=500))

    def test_passes_a_new_schema_with_adr_and_tests(self):
        self.adr()
        self.new_schema()
        self.write("packages/contracts/src/turn.test.ts", frozen.TEST.format(title="parses a turn"))
        self.commit("feat(contracts): turn schema (ADR 0012)")
        self.assertPasses()

    def test_fails_when_only_a_new_schema_accompanies_a_shared_building_block_change(self):
        self.adr()
        self.new_schema()
        self.write("packages/contracts/src/common.ts", frozen.COMMON.format(max_label=80))
        self.write("packages/contracts/src/segment.test.ts", frozen.TEST.format(title="accepts a label of 80 characters"))
        self.commit("feat(contracts): turn schema, speaker label up to 80 characters (ADR 0012)")
        code, out = self.check()
        self.assertNotEqual(code, 0, out)
        self.assertIn("shared building blocks", out)

    def test_fails_when_the_named_adr_exists_but_is_not_part_of_the_change_set(self):
        self.write("packages/contracts/src/segment.ts", frozen.SCHEMA.format(version=3, max_text=4000))
        self.write("packages/contracts/src/segment.test.ts", frozen.TEST.format(title="refuses a text over 4000 characters"))
        self.commit("feat(contracts)!: segment text limit 4000, schemaVersion 3 (ADR 0005)")
        code, out = self.check()
        self.assertNotEqual(code, 0, out)
        self.assertIn("ADR 0005", out)

    def test_fails_on_a_path_with_a_space_under_contracts(self):
        self.adr()
        self.new_schema("packages/contracts/src/turn schema.ts")
        self.write("packages/contracts/src/turn.test.ts", frozen.TEST.format(title="parses a turn"))
        self.commit("feat(contracts): turn schema (ADR 0012)")
        code, out = self.check()
        self.assertNotEqual(code, 0, out)
        self.assertIn("unusual path", out)

    def test_fails_on_a_non_ascii_path_under_contracts(self):
        self.adr()
        self.new_schema("packages/contracts/src/äußerung.ts")
        self.write("packages/contracts/src/turn.test.ts", frozen.TEST.format(title="parses a turn"))
        self.commit("feat(contracts): utterance schema (ADR 0012)")
        code, out = self.check()
        self.assertNotEqual(code, 0, out)
        self.assertIn("unusual path", out)

    def test_fails_on_a_non_ascii_path_under_a_german_utf8_locale(self):
        self.env = {**self.env, "LC_ALL": "de_DE.UTF-8", "LANG": "de_DE.UTF-8"}
        self.test_fails_on_a_non_ascii_path_under_contracts()

    def rename_segment(self, version):
        self.adr()
        self.git("mv", "packages/contracts/src/segment.ts", "packages/contracts/src/text-segment.ts")
        self.write("packages/contracts/src/text-segment.ts", frozen.SCHEMA.format(version=version, max_text=4000))
        self.write("packages/contracts/src/segment.test.ts", frozen.TEST.format(title="refuses a text over 4000 characters"))
        self.commit(f"feat(contracts)!: text segment, limit 4000, schemaVersion {version} (ADR 0012)")

    def test_fails_when_a_renamed_schema_changes_without_a_higher_schema_version(self):
        self.rename_segment(version=2)
        code, out = self.check()
        self.assertNotEqual(code, 0, out)
        self.assertIn("schemaVersion went from 2 to 2", out)

    def test_passes_a_renamed_schema_with_a_higher_schema_version(self):
        self.rename_segment(version=3)
        self.assertPasses()


if __name__ == "__main__":
    unittest.main()
