#!/bin/bash
# Generate the Go monitoring wire types from contracts/proto/metrics.proto.
# Requires protoc 3.21.12 and protoc-gen-go v1.36.10 on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p shared/monitorwire
protoc --proto_path=contracts/proto --go_out=shared/monitorwire --go_opt=paths=source_relative metrics.proto
