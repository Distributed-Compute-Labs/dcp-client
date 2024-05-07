#!/usr/bin/env bash
#
# @file    insecure-config.bash - Tests initializing dcp-client with secure
#          and insecure configuration files.
#
# @author  Bryan Hoang <bryan@distributive.network>
# @date    Mar. 2023

set -e

cd "$(dirname "$0")"/..

TEST_NAME=$(basename "$0")
CONFIG_NAME=$(realpath --relative-to=. "$(mktemp --dry-run -t "$TEST_NAME"-XXXXX)")

touch "$CONFIG_NAME".js

if node --eval "require('.').init({ configName: '$CONFIG_NAME' })" 2>/dev/null; then
  echo 'Test case failed: loading dcp-client with insecure configuration should have errored' >&2
fi

export DCP_CLIENT_ALLOW_INSECURE_CONFIGURATION=1

if ! node --eval "require('.').init()"; then
  echo 'Test case failed: allowing insecure configs when loading dcp-client with default configs should not error' >&2
fi

if ! node --eval "require('.').init({ configName: '$CONFIG_NAME' })"; then
  echo 'Test case failed: allowing insecure configs when loading dcp-client with insecure configs should not error' >&2
fi
