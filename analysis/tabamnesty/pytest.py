"""`npm run pytest` -> pytest over analysis/tests."""
import sys

import pytest

raise SystemExit(pytest.main(sys.argv[1:] or ["-q"]))
