# Copyright (c) 2019 Refael Ackeramnn<refack@gmail.com>. All rights reserved.
# Use of this source code is governed by an MIT-style license.

import re


PLAIN_SOURCE_RE = re.compile(r'\s*"([^/$].+)"\s*')


def scrape_gn_list(gn_filename, pattern):
  with open(gn_filename, 'rb') as gn_file:
    gn_content = gn_file.read().decode('utf-8')

  scraper_re = re.compile(pattern + r'\[([^\]]+)', re.DOTALL)
  matches = scraper_re.search(gn_content)
  if not matches:
    raise Exception('Pattern "%s" not found in %s' % (pattern, gn_filename))

  files = []
  for line in matches.group(1).splitlines():
    match = PLAIN_SOURCE_RE.match(line)
    if match:
      files.append(match.group(1))
  return files
