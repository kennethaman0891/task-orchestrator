#!/opt/homebrew/bin/python3
"""Run the permanent scribe then produce THE PERMANENT RECEIPT. Direct write =
verbatim, no shell mangling possible. Import the installed scribe module so we
REUSE the exact proven lane bodies instead of re-declaring anything."""
import importlib.util, os, sys, time

spec = importlib.util.spec_from_file_location("permanent_scribe",
    "/Users/kennethaman/tto-web/backend/permanent_scribe.py")
scribe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scribe)

# scribe already did: found every lane copy → patched every copy to the safe
# 1-arg session adapter → permanently deregistered every auto-relaunch ever -->
# killed every lane forever --> relaunched mine clean. Now: verify + receipt.
scribe.final_verify_and_receipt()
