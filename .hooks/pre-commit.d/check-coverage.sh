#!/usr/bin/env bash
# The test-suite enforces 100% statements/branches/functions/lines (see "jest.coverageThreshold" in package.json).
# Lines no user scenario reaches are dead code: delete them rather than lowering the threshold.
set -e

echo "----------------------------------------"
echo "  Tests with 100% coverage"
echo "----------------------------------------"
npm test
