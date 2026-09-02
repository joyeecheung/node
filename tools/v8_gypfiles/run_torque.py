#!/usr/bin/env python3

import argparse
import os
import subprocess
import sys

from gn_scraper import scrape_gn_list


TORQUE_FILE_PATTERNS = (
  ('v8_enable_i18n_support',
   r'torque_files =.*?v8_enable_i18n_support.*?torque_files \+= '),
  ('v8_enable_temporal_support',
   r'torque_files =.*?v8_enable_temporal_support.*?torque_files \+= '),
  ('v8_enable_webassembly',
   r'torque_files =.*?v8_enable_webassembly.*?torque_files \+= '),
)


def parse_args():
  parser = argparse.ArgumentParser()
  parser.add_argument('--output-directory', required=True)
  parser.add_argument('--v8-root', required=True)
  parser.add_argument('--v8-enable-i18n-support', action='store_true')
  parser.add_argument('--v8-enable-temporal-support', action='store_true')
  parser.add_argument('--v8-enable-webassembly', action='store_true')
  parser.add_argument('command', nargs=argparse.REMAINDER)
  args = parser.parse_args()
  if args.command[:1] == ['--']:
    args.command = args.command[1:]
  if not args.command:
    parser.error('a Torque command is required after --')
  return args


def scrape_torque_files(v8_root, enabled_features):
  build_gn = os.path.join(v8_root, 'BUILD.gn')
  patterns = [r'torque_files = ']
  patterns.extend(pattern for feature, pattern in TORQUE_FILE_PATTERNS
                  if enabled_features[feature])

  files = []
  for pattern in patterns:
    files.extend(scrape_gn_list(build_gn, pattern))
  return files


def main():
  args = parse_args()
  enabled_features = {
    'v8_enable_i18n_support': args.v8_enable_i18n_support,
    'v8_enable_temporal_support': args.v8_enable_temporal_support,
    'v8_enable_webassembly': args.v8_enable_webassembly,
  }
  torque_files = scrape_torque_files(args.v8_root, enabled_features)
  command = args.command + [
    '-o', args.output_directory,
    '-v8-root', args.v8_root,
    *torque_files,
  ]
  return subprocess.call(command)


if __name__ == '__main__':
  sys.exit(main())
