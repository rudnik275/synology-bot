#!/usr/bin/env bash
set -euo pipefail
exec op run --env-file=.env.1password -- "$@"
